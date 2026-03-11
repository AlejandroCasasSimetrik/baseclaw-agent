/**
 * Level 8 — Agent Middleware
 *
 * Wraps agent functions with automatic:
 *   1. Memory loading (before LLM call)
 *   2. Episode recording (after LLM response)
 *   3. Skill loading (before LLM call)
 *
 * Usage:
 *   export const ideationAgent = withContext(ideationAgentCore, "ideation");
 */

import { Command } from "@langchain/langgraph";
import { SystemMessage } from "@langchain/core/messages";
import { MemoryManager } from "../memory/manager.js";
import { SkillLoader } from "../skills/loader.js";
import { SkillRegistry, registerBuiltinSkills } from "../skills/index.js";
import { buildMCPToolPrompt, getMCPRegistry } from "./mcp-middleware.js";
import type { BaseClawStateType } from "../state.js";
import type { AgentType } from "../memory/types.js";
import { inspectorBus } from "../inspector/index.js";

// Shared instances — initialized once
let _skillRegistry: SkillRegistry | null = null;
const _skillLoader = new SkillLoader();

function getSkillRegistry(): SkillRegistry {
    if (!_skillRegistry) {
        _skillRegistry = new SkillRegistry();
        registerBuiltinSkills(_skillRegistry);
    }
    return _skillRegistry;
}

/** Set an external skill registry (e.g., from index.ts initialization) */
export function setSkillRegistry(registry: SkillRegistry): void {
    _skillRegistry = registry;
}

/**
 * Context loaded before each agent execution.
 * Injected as an extra SystemMessage into the agent's prompt.
 */
interface LoadedContext {
    /** Memory context fragment (episodic + semantic) */
    memoryPrompt: string;
    /** Skill prompt fragment (loaded skills) */
    skillPrompt: string;
    /** IDs of loaded skills — written back to state */
    activeSkillIds: string[];
}

/**
 * Load context for an agent: memory + skills.
 * Degrades gracefully — if DB or Pinecone is down, returns empty context.
 */
async function loadAgentContext(
    agentType: AgentType,
    tenantId: string,
    taskContext: string
): Promise<LoadedContext> {
    let memoryPrompt = "";
    let skillPrompt = "";
    let activeSkillIds: string[] = [];

    // ── Memory ─────────────────────────────────────────────
    let ragCount = 0;
    let memoryCount = 0;
    try {
        const mm = new MemoryManager(tenantId);
        const wm = await mm.loadContext({
            taskId: `task-${Date.now()}`,
            tenantId,
            taskDescription: taskContext || "General conversation",
            agentType,
        });

        // Build memory context from loaded working memory
        const ragItems = wm.ragResults || [];
        ragCount = ragItems.length;
        if (ragItems.length > 0) {
            memoryPrompt =
                "# Relevant Context from Memory\n\n" +
                ragItems
                    .map(
                        (r: { content: string; source: string; score: number }) =>
                            `- [${r.source}] ${r.content}`
                    )
                    .join("\n");
        }

        // Emit memory/RAG events for inspector
        const ragSources = [...new Set(ragItems.map((r: { source: string }) => r.source))];
        inspectorBus.emitContextEvent("rag:loaded", {
            agentType,
            chunkCount: ragCount,
            sources: ragSources,
        });
        inspectorBus.emitContextEvent("memory:loaded", {
            agentType,
            episodicCount: ragCount,
            semanticCount: 0,
        });
    } catch {
        // Memory not available — continue without it
    }

    // ── Skills ─────────────────────────────────────────────
    try {
        const registry = getSkillRegistry();
        const { loadedSkills, skillPrompt: sp } =
            await _skillLoader.loadSkillsForTask(
                agentType,
                taskContext || "",
                registry,
                0.3
            );
        skillPrompt = sp;
        activeSkillIds = loadedSkills.map((s) => s.id);
    } catch {
        // Skills not available — continue without them
    }

    // ── Emit context:loaded summary ────────────────────────
    try {
        const mcpReg = getMCPRegistry();
        const mcpServerIds = mcpReg
            ? mcpReg.getServersForAgent(agentType as any).map((s: { id: string }) => s.id)
            : [];
        inspectorBus.emitContextEvent("context:loaded", {
            agentType,
            skillIds: activeSkillIds,
            mcpServerIds,
            ragChunks: ragCount,
            memoryResults: memoryCount,
        });
    } catch {
        // Inspector emission failure shouldn't break the pipeline
    }

    return { memoryPrompt, skillPrompt, activeSkillIds };
}

/**
 * Build the full set of context messages for an agent.
 * Includes memory, skills, and MCP tool descriptions.
 *
 * Returns a SINGLE SystemMessage[] (0 or 1 element) with all context
 * merged together — required for Anthropic compatibility (system
 * messages must be the first message only).
 */
function buildContextMessages(
    agentType: AgentType,
    context: LoadedContext
): SystemMessage[] {
    const parts: string[] = [];

    if (context.memoryPrompt) {
        parts.push(context.memoryPrompt);
    }
    if (context.skillPrompt) {
        parts.push(context.skillPrompt);
    }

    // MCP tool descriptions
    const mcpPrompt = buildMCPToolPrompt(agentType);
    if (mcpPrompt) {
        const content = typeof mcpPrompt.content === "string"
            ? mcpPrompt.content
            : String(mcpPrompt.content);
        if (content) {
            parts.push(content);
        }
    }

    if (parts.length === 0) return [];

    return [new SystemMessage(parts.join("\n\n"))];
}

/**
 * Record an episode after agent execution.
 * Fire-and-forget — never blocks the response.
 *
 * Also upserts a conversation summary to Pinecone semantic memory
 * so conversations are searchable in long-term knowledge.
 */
async function recordAgentEpisode(
    agentType: AgentType,
    tenantId: string,
    taskDescription: string,
    outcome: string,
    durationMs: number
): Promise<void> {
    try {
        const mm = new MemoryManager(tenantId);
        await mm.recordEpisode({
            agentType,
            taskDescription,
            outcome: outcome.slice(0, 2000),
            durationMs,
            langsmithTraceId: `trace-${Date.now()}`,
        });

        // ── Also write to Pinecone semantic memory ─────────
        // Combine task + outcome into a single text for embedding
        const conversationText =
            `[${agentType}] Task: ${taskDescription}\n\nOutcome: ${outcome.slice(0, 1500)}`;
        try {
            await mm.writeKnowledge(
                conversationText,
                {
                    source: "conversation",
                    timestamp: new Date().toISOString(),
                    agentType,
                    taskId: `episode-${Date.now()}`,
                    tenantId,
                },
                agentType as AgentType
            );
        } catch (semErr) {
            // Pinecone write failure — don't block, just warn
            console.warn(
                `[${agentType}] Failed to write conversation to semantic memory:`,
                (semErr as Error).message
            );
        }
    } catch {
        // DB not available — log but don't block
        console.warn(
            `[${agentType}] Failed to record episode — memory unavailable`
        );
    }
}

/**
 * Wrap an agent function with automatic memory + skill loading.
 *
 * Before the inner agent runs:
 *   1. Loads episodic + semantic memory context
 *   2. Scores and loads relevant skills
 *   3. Injects both as a SystemMessage into the conversation
 *
 * After the inner agent responds:
 *   4. Records the episode to Episodic Memory (fire-and-forget)
 *   5. Updates state with loaded skill IDs
 *
 * @param agentFn - The core agent function to wrap
 * @param agentType - Agent type string (for memory + skills)
 */
export function withContext(
    agentFn: (
        state: BaseClawStateType,
        contextMessages: SystemMessage[]
    ) => Promise<Command>,
    agentType: AgentType
): (state: BaseClawStateType) => Promise<Command> {
    return async (state: BaseClawStateType): Promise<Command> => {
        const startTime = Date.now();
        const tenantId = (state as any).tenantId || "default";

        // ── Load context ───────────────────────────────────
        // Use the actual user message for memory queries (not the generic taskContext)
        const lastUserMessage = state.messages[state.messages.length - 1]?.content?.toString() || "";
        const queryText = lastUserMessage || state.taskContext || "";
        const context = await loadAgentContext(
            agentType,
            tenantId,
            queryText
        );

        // Build context messages (memory + skills + MCP tools)
        const contextMessages = buildContextMessages(agentType, context);

        // ── Execute agent ──────────────────────────────────
        const command = await agentFn(state, contextMessages);

        // ── Record episode (fire-and-forget) ───────────────
        const durationMs = Date.now() - startTime;
        const lastMessage = state.messages[state.messages.length - 1];
        const taskDescription =
            state.taskContext || lastMessage?.content?.toString() || "Unknown task";

        // Extract outcome from the Command's update messages
        const updateMessages =
            (command as any).update?.messages || [];
        const outcome =
            updateMessages.length > 0
                ? updateMessages[updateMessages.length - 1]?.content?.toString() ||
                "Completed"
                : "Completed";

        // Don't await — fire and forget
        recordAgentEpisode(
            agentType,
            tenantId,
            taskDescription,
            outcome,
            durationMs
        ).catch(() => { });

        // ── Unload skills after task completion ────────────
        if (context.activeSkillIds.length > 0) {
            try {
                const registry = getSkillRegistry();
                _skillLoader.unloadSkills(context.activeSkillIds, agentType, registry);
            } catch {
                _skillLoader.unloadSkills(context.activeSkillIds, agentType);
            }
        }

        // ── Signal context unloaded for dynamic UI updates ──
        try {
            inspectorBus.emitContextEvent("context:unloaded", {
                agentType,
                skillIds: context.activeSkillIds,
                ragChunks: 0,
                memoryResults: 0,
            });
        } catch { /* non-critical */ }

        // ── Update state with skill IDs ────────────────────
        if (
            context.activeSkillIds.length > 0 &&
            (command as any).update
        ) {
            (command as any).update.activeSkills = context.activeSkillIds;
        }

        return command;
    };
}
