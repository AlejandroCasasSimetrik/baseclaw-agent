/**
 * Level 3 — Memory Manager
 *
 * Orchestrates the three-tier memory lifecycle:
 *   1. Task arrives → Working Memory loads relevant context
 *   2. Agent executes → Working Memory updated in real-time
 *   3. Task completes → Episode written to PostgreSQL
 *   4. Background distillation (stub) → patterns to Pinecone knowledge
 *   5. Next task benefits from accumulated knowledge
 *
 * All operations traced in LangSmith via `traceable`.
 * Multi-tenant: every operation scoped by tenantId.
 */

import { traceable } from "langsmith/traceable";
import { getModel } from "../models/factory.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { inspectorBus } from "../inspector/index.js";
import {
    createWorkingMemory,
    updateWorkingMemory,
} from "./working-memory.js";
import {
    insertEpisode,
    getRecentEpisodes,
    getEpisodesByAgent,
    searchEpisodes as searchEpisodesQuery,
} from "./episodic/queries.js";
import {
    upsertToKnowledge,
    querySemanticMemory,
    generateEmbedding,
} from "./semantic/pinecone.js";
import type {
    WorkingMemoryState,
    EpisodeInput,
    EpisodeRecord,
    TaskContext,
    MemoryQueryResult,
    SemanticVectorMetadata,
    AgentType,
    RAGQueryFilters,
} from "./types.js";

/**
 * MemoryManager — reusable orchestrator for any agent.
 *
 * Instantiate with a tenantId. All operations are scoped to that tenant.
 */
export class MemoryManager {
    public readonly tenantId: string;

    constructor(tenantId: string) {
        if (!tenantId) {
            throw new Error("MemoryManager requires a non-empty tenantId");
        }
        this.tenantId = tenantId;
    }

    // ── Lifecycle ──────────────────────────────────────────

    /**
     * Load context for a new task.
     *
     * Queries Episodic Memory (recent episodes) and Semantic Memory
     * (knowledge namespace) to pre-populate Working Memory with
     * relevant context.
     *
     * Traced as a LangSmith span.
     */
    loadContext = traceable(
        async (taskContext: TaskContext): Promise<WorkingMemoryState> => {
            // Create fresh working memory
            let wm = createWorkingMemory(
                taskContext.taskId,
                taskContext.tenantId || this.tenantId,
                taskContext.taskDescription
            );

            // Query episodic memory for relevant past episodes
            let episodicContext: Array<{ taskDescription: string; outcome: string }> = [];
            try {
                const recentEpisodes = await getRecentEpisodes(
                    this.tenantId,
                    5
                );
                episodicContext = recentEpisodes.map((ep) => ({
                    taskDescription: ep.taskDescription,
                    outcome: ep.outcome,
                }));
            } catch {
                // DB not available — degrade gracefully
            }

            // Query semantic memory for relevant knowledge
            let semanticContext: MemoryQueryResult[] = [];
            let taskEmbedding: number[] | null = null;
            try {
                const semStart = Date.now();
                taskEmbedding = await generateEmbedding(
                    taskContext.taskDescription
                );
                semanticContext = await querySemanticMemory(
                    taskEmbedding,
                    "knowledge",
                    3,
                    this.tenantId
                );
                // Emit semantic query event
                try {
                    const topScore = semanticContext.length > 0 ? Math.max(...semanticContext.map(r => r.score)) : 0;
                    inspectorBus.emitMemoryEvent("memory:semantic_query", {
                        agentType: taskContext.agentType || "unknown",
                        namespace: "knowledge",
                        querySummary: taskContext.taskDescription.slice(0, 80),
                        topK: 3,
                        resultCount: semanticContext.length,
                        topScore,
                        latencyMs: Date.now() - semStart,
                        results: semanticContext.map(r => ({
                            content: (r.content ?? '').slice(0, 150),
                            score: r.score,
                            source: r.metadata?.source || r.id || 'unknown',
                        })),
                    });
                } catch { /* never block core ops */ }
            } catch {
                // Pinecone not available — degrade gracefully
            }

            // Query RAG namespace for uploaded file content
            let ragContext: MemoryQueryResult[] = [];
            try {
                const ragStart = Date.now();
                const ragEmbedding = taskEmbedding ?? await generateEmbedding(
                    taskContext.taskDescription
                );
                ragContext = await querySemanticMemory(
                    ragEmbedding,
                    "rag",
                    5,
                    this.tenantId
                );
                // Emit RAG query event
                try {
                    const topScore = ragContext.length > 0 ? Math.max(...ragContext.map(r => r.score)) : 0;
                    inspectorBus.emitMemoryEvent("memory:semantic_query", {
                        agentType: taskContext.agentType || "unknown",
                        namespace: "rag",
                        querySummary: taskContext.taskDescription.slice(0, 80),
                        topK: 5,
                        resultCount: ragContext.length,
                        topScore,
                        latencyMs: Date.now() - ragStart,
                        results: ragContext.map(r => ({
                            content: (r.content ?? '').slice(0, 150),
                            score: r.score,
                            source: r.metadata?.source || r.id || 'unknown',
                        })),
                    });
                } catch { /* never block core ops */ }
            } catch {
                // RAG namespace not available — degrade gracefully
            }

            // Populate working memory with loaded context
            wm = updateWorkingMemory(wm, {
                currentGoal: taskContext.taskDescription,
                ragResults: [
                    ...episodicContext.map((ep) => ({
                        content: `[Past Episode] ${ep.taskDescription}: ${ep.outcome}`,
                        source: "episodic",
                        score: 1.0,
                        timestamp: new Date().toISOString(),
                    })),
                    ...semanticContext.map((sr) => ({
                        content: sr.content ?? `Knowledge: ${sr.id}`,
                        source: "semantic-knowledge",
                        score: sr.score,
                        timestamp: sr.metadata?.timestamp ?? new Date().toISOString(),
                    })),
                    ...ragContext.map((rr) => ({
                        content: rr.content ?? `Document: ${rr.id}`,
                        source: "rag-document",
                        score: rr.score,
                        timestamp: rr.metadata?.timestamp ?? new Date().toISOString(),
                    })),
                ],
            });

            // Emit inspector event
            try {
                const itemCount = episodicContext.length + semanticContext.length + ragContext.length;
                inspectorBus.emitMemoryEvent("memory:working_loaded", {
                    agentType: taskContext.agentType || "unknown",
                    taskId: taskContext.taskId,
                    itemCount,
                    tokenEstimate: wm.currentTokenEstimate,
                    tokenBudget: wm.maxTokenBudget,
                    snapshot: wm,
                });
            } catch { /* never block core ops */ }

            return wm;
        },
        { name: "memory.loadContext" }
    );

    /**
     * Record a completed episode to PostgreSQL (Episodic Memory).
     *
     * Appends the episode with the LangSmith trace ID for
     * bidirectional navigation.
     *
     * Traced as a LangSmith span.
     */
    recordEpisode = traceable(
        async (episode: EpisodeInput): Promise<EpisodeRecord> => {
            const inserted = await insertEpisode(this.tenantId, episode);

            const result: EpisodeRecord = {
                id: inserted.id,
                tenantId: inserted.tenantId,
                agentType: inserted.agentType as AgentType,
                taskDescription: inserted.taskDescription,
                outcome: inserted.outcome,
                durationMs: inserted.durationMs,
                langsmithTraceId: inserted.langsmithTraceId,
                metadata: inserted.metadata as Record<string, unknown> | undefined,
                createdAt: inserted.createdAt,
            };

            // Emit inspector event
            try {
                inspectorBus.emitMemoryEvent("memory:episode_written", {
                    agentType: result.agentType,
                    episodeId: result.id,
                    taskSummary: (result.taskDescription || "").slice(0, 80),
                    outcome: result.outcome,
                    langsmithTraceId: result.langsmithTraceId || "",
                });
            } catch { /* never block core ops */ }

            // Fire-and-forget: extract conversation facts → Pinecone knowledge
            this._postConversationMemory(result).catch(() => { });

            return result;
        },
        { name: "memory.recordEpisode" }
    );

    // ── Conversation Memory Pipeline ──────────────────────────

    /**
     * Post-conversation memory pipeline (fire-and-forget):
     *
     * 1. Store FULL conversation text → Pinecone knowledge (long-term memory)
     * 2. Extract user preferences/facts → markdown file (user-preferences.md)
     */
    private async _postConversationMemory(
        episode: EpisodeRecord
    ): Promise<void> {
        // Only process conversation agent episodes
        if (episode.agentType !== "conversation") return;

        const content = `${episode.taskDescription || ""}\n${episode.outcome || ""}`;
        if (content.trim().length < 20) return;

        // ── Tier 3: Full conversation → Pinecone (long-term memory) ──
        try {
            const timestamp = new Date().toISOString();
            const fullText = `[${episode.agentType}] Task: ${episode.taskDescription || "unknown"}\n\nOutcome: ${episode.outcome || "No outcome"}`;
            await this.writeKnowledge(
                fullText.slice(0, 5000),
                {
                    source: "conversation_full",
                    timestamp,
                    agentType: episode.agentType,
                    taskId: episode.id,
                    tenantId: this.tenantId,
                },
                "conversation"
            );
            console.log(`📝 Full conversation → Pinecone knowledge`);
        } catch (err) {
            console.warn(`📝 Pinecone write failed: ${err instanceof Error ? err.message : err}`);
        }

        // ── Tier 1: User preferences → markdown file ──
        try {
            const model = getModel("memory");

            const response = await model.invoke([
                new SystemMessage(
                    `You extract important USER PREFERENCES and PERSONAL FACTS from conversations. Given a conversation summary, extract any facts about the user worth remembering permanently.

Extract facts like:
- Personal preferences (favorite color, food, etc.)
- Names (pets, family members, friends)
- Important dates or events
- Locations, addresses
- Professional info (job title, company)
- Specific requests or recurring habits
- Key relationships

Respond with a JSON array of fact strings. Each fact should be a complete, standalone sentence.
If there are NO worthwhile user-specific facts, respond with an empty array: []
Respond with VALID JSON ONLY. No markdown, no code fences.`
                ),
                new HumanMessage(content.slice(0, 2000)),
            ]);

            const responseText =
                typeof response.content === "string"
                    ? response.content
                    : String(response.content);

            let facts: string[];
            try {
                const cleaned = responseText
                    .replace(/```json\s*/g, "")
                    .replace(/```\s*/g, "")
                    .trim();
                facts = JSON.parse(cleaned);
            } catch {
                return;
            }

            if (!Array.isArray(facts) || facts.length === 0) return;

            // Append to markdown file
            const { default: fs } = await import("fs");
            const { default: path } = await import("path");
            const prefsDir = path.join(process.cwd(), "data");
            const prefsFile = path.join(prefsDir, "user-preferences.md");

            if (!fs.existsSync(prefsDir)) fs.mkdirSync(prefsDir, { recursive: true });

            // Initialize file if it doesn't exist
            if (!fs.existsSync(prefsFile)) {
                fs.writeFileSync(prefsFile, `# User Preferences & Facts\n\nAutomatically extracted from conversations. Safe to edit manually.\n\n---\n\n`);
            }

            // Deduplicate: read existing content and skip already-stored facts
            const existing = fs.readFileSync(prefsFile, "utf-8");
            const newFacts = facts.filter(
                (f) => typeof f === "string" && f.length >= 5 && !existing.includes(f)
            );

            if (newFacts.length > 0) {
                const timestamp = new Date().toLocaleString();
                const block = `### ${timestamp}\n${newFacts.map((f) => `- ${f}`).join("\n")}\n\n`;
                fs.appendFileSync(prefsFile, block);
                console.log(`🧠 ${newFacts.length} preference(s) → data/user-preferences.md`);
            }
        } catch (err) {
            console.warn(`🧠 Preference extraction failed: ${err instanceof Error ? err.message : err}`);
        }
    }

    // ── Semantic Memory ────────────────────────────────────

    /**
     * Write validated knowledge to Pinecone knowledge namespace.
     *
     * RESTRICTED: Only Reviewer Agent or distillation can call this.
     * Throws for all other agents.
     *
     * Traced as a LangSmith span.
     */
    writeKnowledge = traceable(
        async (
            text: string,
            metadata: {
                source: string;
                timestamp: string;
                agentType: string;
                taskId: string;
                tenantId?: string;
            },
            callerAgent: AgentType | "distillation"
        ): Promise<void> => {
            const embedding = await generateEmbedding(text);

            const vectorId = `knowledge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            const fullMetadata: SemanticVectorMetadata & { text: string } = {
                source: metadata.source,
                timestamp: metadata.timestamp,
                agentType: metadata.agentType,
                taskId: metadata.taskId,
                tenantId: metadata.tenantId || this.tenantId,
                namespace: "knowledge",
                text: text.slice(0, 1000), // Store text so it's returned on query
            };

            await upsertToKnowledge(
                [
                    {
                        id: vectorId,
                        values: embedding,
                        metadata: fullMetadata,
                    },
                ],
                callerAgent
            );

            // Emit inspector event
            try {
                inspectorBus.emitMemoryEvent("memory:semantic_write", {
                    agentType: metadata.agentType,
                    namespace: "knowledge",
                    knowledgeType: metadata.source,
                });
            } catch { /* never block core ops */ }
        },
        { name: "memory.writeKnowledge" }
    );

    /**
     * Query the knowledge namespace for relevant semantic matches.
     *
     * Traced as a LangSmith span.
     */
    queryKnowledge = traceable(
        async (
            query: string,
            topK: number = 5
        ): Promise<MemoryQueryResult[]> => {
            const start = Date.now();
            const embedding = await generateEmbedding(query);
            const results = await querySemanticMemory(
                embedding,
                "knowledge",
                topK,
                this.tenantId
            );

            // Emit inspector event
            try {
                const topScore = results.length > 0 ? Math.max(...results.map(r => r.score)) : 0;
                inspectorBus.emitMemoryEvent("memory:semantic_query", {
                    agentType: "unknown",
                    namespace: "knowledge",
                    querySummary: query.slice(0, 80),
                    topK,
                    resultCount: results.length,
                    topScore,
                    latencyMs: Date.now() - start,
                });
            } catch { /* never block core ops */ }

            return results;
        },
        { name: "memory.queryKnowledge" }
    );

    /**
     * Query the RAG namespace for relevant document matches.
     *
     * Enhanced in Level 5 to support filtered search by:
     *   - phase: which workflow phase uploaded the file
     *   - agent: which agent was active
     *   - fileType: file extension filter
     *   - sourceFile: specific source filename
     *
     * Traced as a LangSmith span.
     */
    queryRAG = traceable(
        async (
            query: string,
            topK: number = 5,
            filters?: RAGQueryFilters
        ): Promise<MemoryQueryResult[]> => {
            const start = Date.now();
            const embedding = await generateEmbedding(query);

            // Build Pinecone metadata filters from RAGQueryFilters
            const additionalFilters: Record<string, string> = {};
            if (filters?.phase) additionalFilters.active_phase = filters.phase;
            if (filters?.agent) additionalFilters.active_agent = filters.agent;
            if (filters?.fileType) additionalFilters.file_type = filters.fileType;
            if (filters?.sourceFile) additionalFilters.source_file = filters.sourceFile;

            const results = await querySemanticMemory(
                embedding,
                "rag",
                topK,
                this.tenantId,
                Object.keys(additionalFilters).length > 0 ? additionalFilters : undefined
            );

            // Emit inspector event
            try {
                const topScore = results.length > 0 ? Math.max(...results.map(r => r.score)) : 0;
                inspectorBus.emitMemoryEvent("memory:semantic_query", {
                    agentType: "unknown",
                    namespace: "rag",
                    querySummary: query.slice(0, 80),
                    topK,
                    resultCount: results.length,
                    topScore,
                    latencyMs: Date.now() - start,
                });
            } catch { /* never block core ops */ }

            return results;
        },
        { name: "memory.queryRAG" }
    );

    // ── Episodic Memory (read delegation) ──────────────────

    /**
     * Get recent episodes for this tenant.
     */
    async getRecentEpisodes(limit: number = 20) {
        return getRecentEpisodes(this.tenantId, limit);
    }

    /**
     * Get episodes filtered by agent type.
     */
    async getEpisodesByAgent(agentType: string) {
        return getEpisodesByAgent(this.tenantId, agentType);
    }

    /**
     * Search episodes by text query.
     */
    async searchEpisodes(query: string) {
        return searchEpisodesQuery(this.tenantId, query);
    }
}
