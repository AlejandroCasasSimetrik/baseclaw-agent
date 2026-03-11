/**
 * Level 10 — Background Distillation
 *
 * Periodically scans recent Episodic Memory entries to identify
 * recurring patterns across multiple tasks. Distills these into
 * knowledge entries and writes to Pinecone.
 *
 * Can be triggered by the Heartbeat during idle periods.
 *
 * Uses the "distillation" caller identity for Pinecone writes
 * (allowed alongside "reviewer" in the KNOWLEDGE_WRITERS set).
 *
 * Traced as LangSmith spans: reviewer.background_distillation
 */

import { traceable } from "langsmith/traceable";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { MemoryManager } from "../memory/manager.js";
import type { DistilledKnowledge, KnowledgeType } from "./types.js";

// ── LLM ──────────────────────────────────────────────────

let _bgDistillModel: ChatOpenAI | null = null;

function getBgDistillModel(): ChatOpenAI {
    if (!_bgDistillModel) {
        _bgDistillModel = new ChatOpenAI({
            model: "gpt-4o-mini",
            temperature: 0.2,
        });
    }
    return _bgDistillModel;
}

// ── Background Distillation Prompt ───────────────────────

const BG_DISTILLATION_PROMPT = `You are the Background Distillation engine. Given a batch of recent task episodes and review feedback, identify recurring patterns that are worth persisting as reusable knowledge.

Look for:
1. Patterns: approaches that consistently work well
2. Anti-patterns: things that consistently cause problems
3. Criteria: quality standards that emerged from reviews
4. Templates: structures or formats that work well repeatedly

Only output patterns that appear in MULTIPLE episodes — single occurrences are not patterns.

RESPOND WITH VALID JSON ONLY. No markdown, no code fences:
{
  "patterns": [
    {
      "content": "<the insight>",
      "knowledgeType": "pattern" | "anti_pattern" | "criteria" | "template",
      "agentRelevance": ["<agent types>"],
      "evidenceCount": <number of episodes supporting this pattern>
    }
  ]
}

If no meaningful patterns found: { "patterns": [] }`;

// ── Core Background Distillation ─────────────────────────

/**
 * Run background distillation — scan Episodic Memory for patterns.
 *
 * Designed to be called by the Heartbeat scheduler during idle periods.
 *
 * @param tenantId - Tenant scope
 * @param episodeLimit - How many recent episodes to scan (default: 50)
 * @returns Array of distilled knowledge entries
 */
export const runBackgroundDistillation = traceable(
    async (
        tenantId: string,
        episodeLimit: number = 50
    ): Promise<DistilledKnowledge[]> => {
        const mm = new MemoryManager(tenantId);
        const model = getBgDistillModel();

        // Fetch recent episodes
        let episodes: any[];
        try {
            episodes = await mm.getRecentEpisodes(episodeLimit);
        } catch {
            return []; // DB not available
        }

        if (episodes.length < 5) {
            // Not enough data to find patterns
            return [];
        }

        // Build episode summary for the LLM
        const episodeSummary = episodes
            .slice(0, 30) // Don't overwhelm the context
            .map(
                (ep: any) =>
                    `[${ep.agentType}] Task: ${ep.taskDescription?.slice(0, 100)} → Outcome: ${ep.outcome?.slice(0, 100)}`
            )
            .join("\n");

        const humanMessage = `Analyze these ${episodes.length} recent task episodes and identify recurring patterns:

${episodeSummary}

Look for patterns that appear in multiple episodes. Focus on quality and approach patterns.`;

        const response = await model.invoke([
            new SystemMessage(BG_DISTILLATION_PROMPT),
            new HumanMessage(humanMessage),
        ]);

        const responseText =
            typeof response.content === "string"
                ? response.content
                : String(response.content);

        let parsed: any;
        try {
            const cleaned = responseText
                .replace(/```json\s*/g, "")
                .replace(/```\s*/g, "")
                .trim();
            parsed = JSON.parse(cleaned);
        } catch {
            return [];
        }

        if (!Array.isArray(parsed.patterns) || parsed.patterns.length === 0) {
            return [];
        }

        // Write each pattern to Pinecone
        const distilled: DistilledKnowledge[] = [];

        for (const pattern of parsed.patterns) {
            if (
                !pattern.content ||
                String(pattern.content).length < 10 ||
                (pattern.evidenceCount ?? 0) < 2
            ) {
                continue; // Skip weak patterns
            }

            const knowledge: DistilledKnowledge = {
                content: String(pattern.content),
                knowledgeType: _validateKnowledgeType(pattern.knowledgeType),
                agentRelevance: Array.isArray(pattern.agentRelevance)
                    ? pattern.agentRelevance.map(String)
                    : ["execution"],
                sourceTaskId: `background-distillation-${Date.now()}`,
                sourceReviewId: `bg-distill-${Date.now()}`,
                tenantId,
                timestamp: new Date().toISOString(),
            };

            try {
                await mm.writeKnowledge(
                    knowledge.content,
                    {
                        source: "background_distillation",
                        timestamp: knowledge.timestamp,
                        agentType: knowledge.agentRelevance[0] || "reviewer",
                        taskId: knowledge.sourceTaskId,
                        tenantId,
                        knowledge_type: knowledge.knowledgeType,
                        agent_relevance: knowledge.agentRelevance.join(","),
                    } as any,
                    "distillation"
                );
                distilled.push(knowledge);
            } catch {
                // Write failed — skip this entry
            }
        }

        return distilled;
    },
    { name: "reviewer.background_distillation", run_type: "chain" }
);

// ── Helpers ──────────────────────────────────────────────

const VALID_KNOWLEDGE_TYPES: Set<string> = new Set([
    "pattern",
    "anti_pattern",
    "criteria",
    "template",
]);

function _validateKnowledgeType(type: string): KnowledgeType {
    return VALID_KNOWLEDGE_TYPES.has(type)
        ? (type as KnowledgeType)
        : "pattern";
}
