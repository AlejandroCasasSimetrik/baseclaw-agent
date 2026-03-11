/**
 * Level 10 — Knowledge Distillation
 *
 * The Reviewer has exclusive write access to Semantic Memory's knowledge
 * namespace. After successful reviews (approved outputs), the Reviewer can
 * optionally distill learnings into persistent knowledge.
 *
 * Distillation is selective — not every review produces knowledge.
 * The Reviewer decides when an insight is worth persisting.
 *
 * Knowledge types:
 *   - pattern: "This type of task is best approached with X strategy"
 *   - anti_pattern: "Avoid Y when doing Z — it leads to quality issues"
 *   - criteria: "For tasks in domain X, pay special attention to Y"
 *   - template: "This plan structure worked well for X type of projects"
 *
 * Traced as LangSmith spans: reviewer.distillation
 */

import { traceable } from "langsmith/traceable";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { MemoryManager } from "../memory/manager.js";
import type { QualityAssessment, DistilledKnowledge, KnowledgeType } from "./types.js";
import type { AgentType } from "../skills/types.js";

// ── LLM ──────────────────────────────────────────────────

let _distillModel: ChatOpenAI | null = null;

function getDistillModel(): ChatOpenAI {
    if (!_distillModel) {
        _distillModel = new ChatOpenAI({
            model: "gpt-4o-mini",
            temperature: 0.3,
        });
    }
    return _distillModel;
}

// ── Distillation Prompt ──────────────────────────────────

const DISTILLATION_SYSTEM_PROMPT = `You are the Reviewer Agent's knowledge distillation engine. Given a successful review, decide whether there is a reusable insight worth preserving for future tasks.

Not every review produces knowledge — only distill when there's a genuinely useful pattern, anti-pattern, criteria, or template.

If there IS a useful insight, respond with:
{
  "shouldDistill": true,
  "knowledge": {
    "content": "<the insight>",
    "knowledgeType": "pattern" | "anti_pattern" | "criteria" | "template",
    "agentRelevance": ["<agent types this is most relevant to>"]
  }
}

If there is NO worthwhile insight:
{
  "shouldDistill": false
}

RESPOND WITH VALID JSON ONLY. No markdown, no code fences. Be selective — only distill genuinely reusable knowledge.`;

// ── Core Distillation Function ───────────────────────────

/**
 * Attempt to distill knowledge from a successful review.
 *
 * Called after a review results in "approved" verdict.
 * Decides whether the review produced a worthwhile insight.
 * If so, writes it to Pinecone's knowledge namespace.
 *
 * @param assessment - The quality assessment that approved the output
 * @param output - The approved output text
 * @param taskContext - The original task/goal
 * @param tenantId - Tenant scope
 * @returns DistilledKnowledge if distilled, null otherwise
 */
export const distillKnowledge = traceable(
    async (
        assessment: QualityAssessment,
        output: string,
        taskContext: string,
        tenantId: string
    ): Promise<DistilledKnowledge | null> => {
        const model = getDistillModel();

        const dimensionSummary = assessment.dimensions
            .map((d) => `${d.dimension}: ${d.score}/100`)
            .join(", ");

        const humanMessage = `Task: ${taskContext}
Agent: ${assessment.sourceAgent}
Quality Scores: ${dimensionSummary}
Overall: ${assessment.overallScore}/100

Output (excerpt):
${output.slice(0, 3000)}

Is there a reusable insight worth preserving for future tasks?`;

        const response = await model.invoke([
            new SystemMessage(DISTILLATION_SYSTEM_PROMPT),
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
            return null; // Can't parse — don't distill
        }

        if (!parsed.shouldDistill || !parsed.knowledge) {
            return null;
        }

        const knowledge: DistilledKnowledge = {
            content: String(parsed.knowledge.content || ""),
            knowledgeType: _validateKnowledgeType(
                parsed.knowledge.knowledgeType
            ),
            agentRelevance: Array.isArray(parsed.knowledge.agentRelevance)
                ? parsed.knowledge.agentRelevance.map(String)
                : [assessment.sourceAgent],
            sourceTaskId: assessment.taskContext.slice(0, 100),
            sourceReviewId: assessment.reviewId,
            tenantId,
            timestamp: new Date().toISOString(),
        };

        // Validate content is substantive
        if (knowledge.content.length < 10) {
            return null;
        }

        // Write to Pinecone knowledge namespace via MemoryManager
        await _writeKnowledgeToPinecone(knowledge, tenantId);

        return knowledge;
    },
    { name: "reviewer.distillation", run_type: "chain" }
);

// ── Write to Pinecone ────────────────────────────────────

const _writeKnowledgeToPinecone = traceable(
    async (
        knowledge: DistilledKnowledge,
        tenantId: string
    ): Promise<void> => {
        const mm = new MemoryManager(tenantId);

        await mm.writeKnowledge(
            knowledge.content,
            {
                source: "reviewer_distillation",
                timestamp: knowledge.timestamp,
                agentType: knowledge.agentRelevance[0] || "reviewer",
                taskId: knowledge.sourceTaskId,
                tenantId,
                // Extended metadata
                knowledge_type: knowledge.knowledgeType,
                source_review_id: knowledge.sourceReviewId,
                agent_relevance: knowledge.agentRelevance.join(","),
            } as any,
            "reviewer"
        );
    },
    { name: "reviewer.distillation.write", run_type: "chain" }
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
