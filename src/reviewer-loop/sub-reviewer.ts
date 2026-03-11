/**
 * Level 10 — Sub-Reviewer Spawning
 *
 * The Reviewer can spawn sub-Reviewer agents (via Level 8) for
 * deep or parallel reviews of complex outputs.
 *
 * Review types:
 *   - deep: single sub-Reviewer for intensive analysis
 *   - parallel: multiple sub-Reviewers each reviewing a different aspect
 *     (e.g., accuracy, code quality, security)
 *
 * The parent Reviewer aggregates feedback from sub-Reviewers into
 * a single quality assessment.
 *
 * Follows all Level 8 rules: inheritance, max depth, lifecycle.
 *
 * Traced as LangSmith spans: reviewer.sub_review.*
 */

import { traceable } from "langsmith/traceable";
import { v4 as uuidv4 } from "uuid";
import type { QualityAssessment, DimensionScore, QualityDimension, ReviewVerdict } from "./types.js";
import { ALL_QUALITY_DIMENSIONS, getReviewConfig } from "./types.js";
import { determineVerdict, buildSystemAwareness } from "./quality-scorer.js";

// ── Review Focus Definitions ─────────────────────────────

/**
 * Predefined review focus areas for parallel reviews.
 */
export const REVIEW_FOCUS_AREAS = [
    {
        label: "Accuracy & Factual Correctness",
        focus: "Review for factual accuracy and consistency with provided context. Check for hallucinations, incorrect claims, and misinterpretations.",
        dimensions: ["accuracy", "relevance"] as QualityDimension[],
    },
    {
        label: "Completeness & Clarity",
        focus: "Review for completeness — does the output fully address the task? Check for missing steps, incomplete responses, and structural clarity.",
        dimensions: ["completeness", "clarity"] as QualityDimension[],
    },
    {
        label: "Safety & Alignment",
        focus: "Review for safety, alignment, and appropriateness. Check for harmful content, risky suggestions, scope creep, and alignment with the system's goals.",
        dimensions: ["safety", "alignment"] as QualityDimension[],
    },
];

// ── Parallel Sub-Reviewer Results ────────────────────────

interface SubReviewResult {
    focusArea: string;
    output: string;
    success: boolean;
}

// ── Core Sub-Reviewer Functions ──────────────────────────

/**
 * Spawn sub-Reviewers for a complex review.
 *
 * @param output - The agent output to review
 * @param taskContext - Original task/goal
 * @param reviewType - "deep" (single intensive) or "parallel" (multi-aspect)
 * @param tenantId - Tenant scope
 * @param parentTraceId - Parent's LangSmith trace ID
 * @returns Aggregated quality assessment from sub-Reviewers
 */
export const spawnSubReviewers = traceable(
    async (
        output: string,
        taskContext: string,
        reviewType: "deep" | "parallel",
        tenantId: string,
        parentTraceId: string
    ): Promise<QualityAssessment> => {
        if (reviewType === "deep") {
            return _runDeepReview(output, taskContext, tenantId, parentTraceId);
        } else {
            return _runParallelReview(output, taskContext, tenantId, parentTraceId);
        }
    },
    { name: "reviewer.sub_review", run_type: "chain" }
);

// ── Deep Review ──────────────────────────────────────────

const _runDeepReview = traceable(
    async (
        output: string,
        taskContext: string,
        tenantId: string,
        parentTraceId: string
    ): Promise<QualityAssessment> => {
        // Use Level 8's runSubAgent for a single intensive review
        let subResult: any;
        try {
            const { runSubAgent } = await import("../subagent/lifecycle.js");
            subResult = await runSubAgent({
                task: `Perform a DEEP quality review of the following agent output.\n\nTask/Goal: ${taskContext}\n\nOutput to review:\n${output.slice(0, 6000)}\n\nScore each dimension (accuracy, completeness, clarity, relevance, safety, alignment) from 0-100 with reasoning. Respond with JSON: { "dimensions": { "accuracy": { "score": N, "reasoning": "..." }, ... }, "confidence": N, "observations": "..." }`,
                parentAgentId: `reviewer-main-${uuidv4().slice(0, 8)}`,
                parentAgentType: "reviewer",
                tenantId,
                parentSkillIds: [],
                parentTraceId,
            });
        } catch {
            // Sub-agent failed — return a conservative assessment
            return _buildFallbackAssessment(taskContext);
        }

        // Parse the sub-reviewer's output
        return _aggregateSubReviews(
            [
                {
                    focusArea: "Deep Review",
                    output: subResult?.output ?? "",
                    success: true,
                },
            ],
            taskContext
        );
    },
    { name: "reviewer.sub_review.deep", run_type: "chain" }
);

// ── Parallel Review ──────────────────────────────────────

const _runParallelReview = traceable(
    async (
        output: string,
        taskContext: string,
        tenantId: string,
        parentTraceId: string
    ): Promise<QualityAssessment> => {
        let runSubAgent: typeof import("../subagent/lifecycle.js").runSubAgent;
        try {
            const lifecycle = await import("../subagent/lifecycle.js");
            runSubAgent = lifecycle.runSubAgent;
        } catch {
            return _buildFallbackAssessment(taskContext);
        }

        // Spawn parallel sub-Reviewers for each focus area
        const parentId = `reviewer-parallel-${uuidv4().slice(0, 8)}`;
        const subReviewPromises = REVIEW_FOCUS_AREAS.map(async (focus) => {
            try {
                const result = await runSubAgent({
                    task: `Review focus: ${focus.label}\n\n${focus.focus}\n\nTask/Goal: ${taskContext}\n\nOutput to review:\n${output.slice(0, 4000)}\n\nScore these dimensions from 0-100: ${focus.dimensions.join(", ")}. Respond with JSON: { "dimensions": { ${focus.dimensions.map((d) => `"${d}": { "score": N, "reasoning": "..." }`).join(", ")} }, "observations": "..." }`,
                    parentAgentId: parentId,
                    parentAgentType: "reviewer",
                    tenantId,
                    parentSkillIds: [],
                    parentTraceId,
                });
                return {
                    focusArea: focus.label,
                    output: result.output,
                    success: true,
                } as SubReviewResult;
            } catch {
                return {
                    focusArea: focus.label,
                    output: "",
                    success: false,
                } as SubReviewResult;
            }
        });

        const subResults = await Promise.all(subReviewPromises);

        // Aggregate results from all sub-Reviewers
        return _aggregateSubReviews(subResults, taskContext);
    },
    { name: "reviewer.sub_review.parallel", run_type: "chain" }
);

// ── Result Aggregation ───────────────────────────────────

/**
 * Aggregate results from multiple sub-Reviewers into a single assessment.
 */
function _aggregateSubReviews(
    results: SubReviewResult[],
    taskContext: string
): QualityAssessment {
    const dimensionScores: Map<QualityDimension, number[]> = new Map();
    const dimensionReasonings: Map<QualityDimension, string[]> = new Map();

    // Initialize
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        dimensionScores.set(dim, []);
        dimensionReasonings.set(dim, []);
    }

    // Parse each sub-reviewer's output and collect scores
    for (const result of results) {
        if (!result.success || !result.output) continue;

        try {
            const cleaned = result.output
                .replace(/```json\s*/g, "")
                .replace(/```\s*/g, "")
                .trim();

            // Try to extract JSON from the output
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch) continue;

            const parsed = JSON.parse(jsonMatch[0]);
            if (!parsed.dimensions) continue;

            for (const [dim, data] of Object.entries(parsed.dimensions) as [string, any][]) {
                if (dimensionScores.has(dim as QualityDimension)) {
                    const score = (data as any)?.score;
                    const reasoning = (data as any)?.reasoning;
                    if (typeof score === "number") {
                        dimensionScores.get(dim as QualityDimension)!.push(
                            Math.max(0, Math.min(100, score))
                        );
                    }
                    if (typeof reasoning === "string") {
                        dimensionReasonings
                            .get(dim as QualityDimension)!
                            .push(reasoning);
                    }
                }
            }
        } catch {
            // Parse failed for this sub-reviewer — skip
        }
    }

    // Compute average scores per dimension
    const dimensions: DimensionScore[] = ALL_QUALITY_DIMENSIONS.map((dim: QualityDimension) => {
        const scores = dimensionScores.get(dim) || [];
        const reasonings = dimensionReasonings.get(dim) || [];
        const avgScore =
            scores.length > 0
                ? Math.round(
                    scores.reduce((a, b) => a + b, 0) / scores.length
                )
                : 50;
        return {
            dimension: dim,
            score: avgScore,
            reasoning:
                reasonings.length > 0
                    ? reasonings.join("; ")
                    : "No sub-reviewer data for this dimension.",
        };
    });

    // Compute overall score
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

    const reviewId = `review-sub-${Date.now()}-${uuidv4().slice(0, 8)}`;

    return {
        reviewId,
        overallScore,
        dimensions,
        verdict: determineVerdict(overallScore),
        confidence: results.filter((r) => r.success).length > 0 ? 65 : 20,
        systemAwareness: buildSystemAwareness(),
        triggerType: "mandatory_gate",
        sourceAgent: "reviewer",
        taskContext,
        timestamp: new Date().toISOString(),
        langsmithTraceId: `trace-sub-review-${reviewId}`,
    };
}

// ── Fallback ─────────────────────────────────────────────

function _buildFallbackAssessment(taskContext: string): QualityAssessment {
    const reviewId = `review-fallback-${Date.now()}`;
    return {
        reviewId,
        overallScore: 50,
        dimensions: ALL_QUALITY_DIMENSIONS.map((dim) => ({
            dimension: dim,
            score: 50,
            reasoning: "Sub-reviewer failed; defaulting to 50.",
        })),
        verdict: "needs_revision",
        confidence: 10,
        systemAwareness: buildSystemAwareness(),
        triggerType: "mandatory_gate",
        sourceAgent: "reviewer",
        taskContext,
        timestamp: new Date().toISOString(),
        langsmithTraceId: `trace-review-${reviewId}`,
    };
}
