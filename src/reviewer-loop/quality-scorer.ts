/**
 * Level 10 — Quality Scorer
 *
 * LLM-based quality scoring across 6 dimensions.
 * Uses GPT-4o-mini with structured JSON output for reliable scoring.
 *
 * Dimensions: accuracy, completeness, clarity, relevance, safety, alignment
 *
 * The Reviewer produces a QualityAssessment for every review, including:
 *   - Per-dimension scores (0-100)
 *   - Overall weighted score
 *   - Verdict based on configurable thresholds
 *   - Confidence level
 *   - System awareness snapshot
 *
 * Traced as LangSmith spans: reviewer.gate.score
 */

import { v4 as uuidv4 } from "uuid";
import { traceable } from "langsmith/traceable";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getModel } from "../models/factory.js";
import type {
    QualityAssessment,
    DimensionScore,
    ReviewVerdict,
    ReviewTriggerType,
    SystemAwareness,
    RevisionRound,
} from "./types.js";
import { ALL_QUALITY_DIMENSIONS, getReviewConfig } from "./types.js";
import type { AgentType } from "../skills/types.js";

// ── LLM ──────────────────────────────────────────────────

/** Model is resolved from centralized factory (configured via .env) */

// ── System Awareness Builder ─────────────────────────────

/**
 * Build a system awareness snapshot.
 * In a full deployment, this would query the SubAgentRegistry,
 * HeartbeatScheduler, and ContinuousTaskManager for real data.
 */
export function buildSystemAwareness(
    systemState?: Partial<SystemAwareness>
): SystemAwareness {
    return {
        activeAgents: systemState?.activeAgents ?? [],
        activeSubAgents: systemState?.activeSubAgents ?? [],
        pendingTasks: systemState?.pendingTasks ?? 0,
        driftDetected: systemState?.driftDetected ?? false,
        contradictionDetected: systemState?.contradictionDetected ?? false,
        scopeCreepDetected: systemState?.scopeCreepDetected ?? false,
        riskAccumulation: systemState?.riskAccumulation ?? false,
        observations: systemState?.observations ?? "No issues detected.",
    };
}

// ── Scoring Prompt ───────────────────────────────────────

const SCORING_SYSTEM_PROMPT = `You are the Reviewer Agent's quality scoring engine. You must evaluate an agent's output across 6 quality dimensions.

For each dimension, provide a score from 0-100 and a brief reasoning:

1. **accuracy**: Is the output factually correct and consistent with available context?
2. **completeness**: Does the output fully address the original task/goal?
3. **clarity**: Is the output clear, well-structured, and understandable?
4. **relevance**: Is every part of the output relevant to the task?
5. **safety**: Does the output contain any harmful, risky, or inappropriate content? (100 = completely safe)
6. **alignment**: Is the output aligned with the overall system goal and what other agents have produced?

Also provide:
- **confidence**: 0-100, how confident you are in your assessment
- **observations**: Any system-level concerns (drift, contradictions, scope creep, risk accumulation)

RESPOND WITH VALID JSON ONLY. No markdown, no code fences. Use this exact structure:
{
  "dimensions": {
    "accuracy": { "score": <number>, "reasoning": "<string>" },
    "completeness": { "score": <number>, "reasoning": "<string>" },
    "clarity": { "score": <number>, "reasoning": "<string>" },
    "relevance": { "score": <number>, "reasoning": "<string>" },
    "safety": { "score": <number>, "reasoning": "<string>" },
    "alignment": { "score": <number>, "reasoning": "<string>" }
  },
  "confidence": <number>,
  "observations": "<string>",
  "driftDetected": <boolean>,
  "contradictionDetected": <boolean>,
  "scopeCreepDetected": <boolean>,
  "riskAccumulation": <boolean>
}`;

// ── Core Scoring Function ────────────────────────────────

/**
 * Score an agent's output across all quality dimensions.
 *
 * Uses a real LLM call to produce structured quality scores.
 * Determines verdict based on configurable thresholds from .env.
 *
 * @param output - The agent's output text to review
 * @param taskContext - The original task/goal
 * @param agentType - Which agent produced the output
 * @param triggerType - What triggered this review
 * @param reviewHistory - Previous review rounds for this task (if any)
 * @param systemState - Optional system state for awareness
 * @returns Full QualityAssessment
 */
export const scoreOutput = traceable(
    async (
        output: string,
        taskContext: string,
        agentType: AgentType,
        triggerType: ReviewTriggerType,
        reviewHistory: RevisionRound[] = [],
        systemState?: Partial<SystemAwareness>
    ): Promise<QualityAssessment> => {
        const config = getReviewConfig();
        const model = getModel("scorer");
        const reviewId = `review-${Date.now()}-${uuidv4().slice(0, 8)}`;

        // Build the human message with all context
        const historyContext =
            reviewHistory.length > 0
                ? `\n\nPrevious review rounds:\n${reviewHistory
                    .map(
                        (r) =>
                            `Round ${r.roundNumber}: score=${r.assessment.overallScore}, verdict=${r.assessment.verdict}`
                    )
                    .join("\n")}`
                : "";

        const systemContext = systemState
            ? `\n\nSystem state: ${JSON.stringify(systemState)}`
            : "";

        const humanMessage = `Task/Goal: ${taskContext}

Agent: ${agentType}

Agent Output:
${output.slice(0, 8000)}${historyContext}${systemContext}

Score this output across all 6 dimensions.`;

        // Make the LLM call
        const response = await model.invoke([
            new SystemMessage(SCORING_SYSTEM_PROMPT),
            new HumanMessage(humanMessage),
        ]);

        const responseText =
            typeof response.content === "string"
                ? response.content
                : String(response.content);

        // Parse the JSON response
        let parsed: any;
        try {
            // Strip potential markdown code fences
            const cleaned = responseText
                .replace(/```json\s*/g, "")
                .replace(/```\s*/g, "")
                .trim();
            parsed = JSON.parse(cleaned);
        } catch {
            // If parsing fails, return a conservative assessment
            return _buildFallbackAssessment(
                reviewId,
                agentType,
                taskContext,
                triggerType,
                systemState
            );
        }

        // Build dimension scores
        const dimensions: DimensionScore[] = ALL_QUALITY_DIMENSIONS.map(
            (dim) => ({
                dimension: dim,
                score: Math.max(
                    0,
                    Math.min(100, parsed.dimensions?.[dim]?.score ?? 50)
                ),
                reasoning:
                    parsed.dimensions?.[dim]?.reasoning ??
                    "No reasoning provided",
            })
        );

        // Compute overall score (weighted average — safety gets 1.5x weight)
        const weights: Record<string, number> = {
            accuracy: 1.0,
            completeness: 1.0,
            clarity: 0.8,
            relevance: 1.0,
            safety: 1.5,
            alignment: 1.2,
        };
        const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
        const overallScore = Math.round(
            dimensions.reduce(
                (sum, d) => sum + d.score * (weights[d.dimension] ?? 1),
                0
            ) / totalWeight
        );

        // Determine verdict based on thresholds
        const verdict = determineVerdict(overallScore, config);

        // Build system awareness
        const awareness = buildSystemAwareness({
            ...systemState,
            driftDetected: parsed.driftDetected ?? false,
            contradictionDetected: parsed.contradictionDetected ?? false,
            scopeCreepDetected: parsed.scopeCreepDetected ?? false,
            riskAccumulation: parsed.riskAccumulation ?? false,
            observations:
                parsed.observations ?? "No system-level issues detected.",
        });

        const assessment: QualityAssessment = {
            reviewId,
            overallScore,
            dimensions,
            verdict,
            confidence: Math.max(
                0,
                Math.min(100, parsed.confidence ?? 70)
            ),
            systemAwareness: awareness,
            triggerType,
            sourceAgent: agentType,
            taskContext,
            timestamp: new Date().toISOString(),
            langsmithTraceId: `trace-review-${reviewId}`,
        };

        return assessment;
    },
    { name: "reviewer.gate.score", run_type: "chain" }
);

// ── Verdict Determination ────────────────────────────────

/**
 * Determine the review verdict based on the overall score and thresholds.
 */
export function determineVerdict(
    overallScore: number,
    config?: { autoApproveThreshold: number; hitlThreshold: number }
): ReviewVerdict {
    const thresholds = config ?? getReviewConfig();

    if (overallScore >= thresholds.autoApproveThreshold) {
        return "approved";
    }
    if (overallScore <= thresholds.hitlThreshold) {
        return "needs_hitl";
    }
    return "needs_revision";
}

// ── Fallback Assessment ──────────────────────────────────

function _buildFallbackAssessment(
    reviewId: string,
    agentType: AgentType,
    taskContext: string,
    triggerType: ReviewTriggerType,
    systemState?: Partial<SystemAwareness>
): QualityAssessment {
    return {
        reviewId,
        overallScore: 50,
        dimensions: ALL_QUALITY_DIMENSIONS.map((dim) => ({
            dimension: dim,
            score: 50,
            reasoning: "Unable to parse LLM scoring response; defaulting to 50.",
        })),
        verdict: "needs_revision",
        confidence: 20,
        systemAwareness: buildSystemAwareness(systemState),
        triggerType,
        sourceAgent: agentType,
        taskContext,
        timestamp: new Date().toISOString(),
        langsmithTraceId: `trace-review-${reviewId}`,
    };
}
