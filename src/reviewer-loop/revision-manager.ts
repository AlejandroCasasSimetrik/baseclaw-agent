/**
 * Level 10 — Revision Manager
 *
 * Manages the revision loop lifecycle:
 *   1. Tracks revision rounds (history of scores, feedback, revisions)
 *   2. Detects score stagnation (no improvement → escalate to HITL)
 *   3. Enforces max revision rounds
 *   4. Records revision history to Episodic Memory (feedback_loops table)
 *
 * Traced as LangSmith spans: reviewer.gate.revision.*
 */

import { traceable } from "langsmith/traceable";
import type {
    RevisionRound,
    QualityAssessment,
    StructuredFeedback,
} from "./types.js";
import { getReviewConfig } from "./types.js";

// ── Revision Round Management ────────────────────────────

/**
 * Create a new revision round from a review.
 */
export function createRevisionRound(
    roundNumber: number,
    originalOutput: string,
    assessment: QualityAssessment,
    feedback: StructuredFeedback | null
): RevisionRound {
    return {
        roundNumber,
        originalOutput: originalOutput.slice(0, 5000), // Limit stored size
        assessment,
        feedback,
        revisedOutput: null,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Update a revision round with the revised output.
 */
export function updateRevisionRoundWithRevision(
    round: RevisionRound,
    revisedOutput: string
): RevisionRound {
    return {
        ...round,
        revisedOutput: revisedOutput.slice(0, 5000),
    };
}

// ── Stagnation Detection ─────────────────────────────────

/**
 * Check if scores are stagnating across revision rounds.
 *
 * Stagnation is detected when the score doesn't improve by at least
 * 5 points between rounds — meaning the revision isn't helping.
 *
 * @param revisionHistory - All rounds so far
 * @returns true if stagnation is detected
 */
export function checkStagnation(revisionHistory: RevisionRound[]): boolean {
    if (revisionHistory.length < 2) {
        return false;
    }

    const lastTwo = revisionHistory.slice(-2);
    const previousScore = lastTwo[0].assessment.overallScore;
    const currentScore = lastTwo[1].assessment.overallScore;

    // Stagnation: score didn't improve by at least 5 points
    return currentScore - previousScore < 5;
}

// ── Escalation Checks ────────────────────────────────────

/**
 * Determine if the revision loop should escalate to HITL.
 *
 * Escalation triggers:
 *   1. Max revision rounds reached
 *   2. Score stagnation detected (no meaningful improvement)
 *
 * @param revisionHistory - All revision rounds
 * @param maxRounds - Max allowed rounds (from config)
 * @returns Object with shouldEscalate flag and reason
 */
export function shouldEscalateToHITL(
    revisionHistory: RevisionRound[],
    maxRounds?: number
): { shouldEscalate: boolean; reason: string } {
    const config = getReviewConfig();
    const limit = maxRounds ?? config.maxRevisionRounds;

    // Check max rounds
    if (revisionHistory.length >= limit) {
        return {
            shouldEscalate: true,
            reason: `Maximum revision rounds (${limit}) reached without approval. ` +
                `Latest score: ${revisionHistory[revisionHistory.length - 1]?.assessment.overallScore ?? "N/A"}.`,
        };
    }

    // Check stagnation
    if (checkStagnation(revisionHistory)) {
        const lastTwo = revisionHistory.slice(-2);
        return {
            shouldEscalate: true,
            reason: `Score stagnation detected. Previous: ${lastTwo[0].assessment.overallScore}, ` +
                `Current: ${lastTwo[1].assessment.overallScore}. Revision is not producing improvement.`,
        };
    }

    return { shouldEscalate: false, reason: "" };
}

// ── Revision History Formatting ──────────────────────────

/**
 * Format revision history as a summary string for HITL context.
 */
export function formatRevisionHistory(
    revisionHistory: RevisionRound[]
): string {
    if (revisionHistory.length === 0) {
        return "No revision history.";
    }

    return revisionHistory
        .map((r) => {
            const issueCount = r.feedback?.issues.length ?? 0;
            return `Round ${r.roundNumber}: score=${r.assessment.overallScore}/100, ` +
                `verdict=${r.assessment.verdict}, issues=${issueCount}`;
        })
        .join("\n");
}

/**
 * Get the score trend across revision rounds.
 *
 * @returns Array of scores in order
 */
export function getScoreTrend(revisionHistory: RevisionRound[]): number[] {
    return revisionHistory.map((r) => r.assessment.overallScore);
}

// ── Episodic Memory Recording ────────────────────────────

/**
 * Record a revision round to Episodic Memory (feedback_loops table).
 *
 * Fire-and-forget — never blocks the revision loop.
 */
export const recordRevisionRound = traceable(
    async (
        round: RevisionRound,
        tenantId: string
    ): Promise<void> => {
        try {
            // Dynamic import to avoid circular dependencies
            const { insertFeedbackLoop } = await import(
                "../memory/episodic/queries.js"
            );
            const { insertEpisode } = await import(
                "../memory/episodic/queries.js"
            );

            // First create an episode for reference
            const episode = await insertEpisode(tenantId, {
                agentType: round.assessment.sourceAgent,
                taskDescription: `Review round ${round.roundNumber}: ${round.assessment.taskContext}`,
                outcome: `Score: ${round.assessment.overallScore}, Verdict: ${round.assessment.verdict}`,
                durationMs: 0,
                langsmithTraceId: round.assessment.langsmithTraceId,
                metadata: {
                    review_id: round.assessment.reviewId,
                    round_number: round.roundNumber,
                    overall_score: round.assessment.overallScore,
                    verdict: round.assessment.verdict,
                },
            });

            // Record the feedback loop
            await insertFeedbackLoop(tenantId, {
                sourceAgent: "reviewer",
                targetAgent: round.assessment.sourceAgent,
                feedbackContent: JSON.stringify({
                    score: round.assessment.overallScore,
                    verdict: round.assessment.verdict,
                    issueCount: round.feedback?.issues.length ?? 0,
                    dimensions: round.assessment.dimensions.map((d) => ({
                        dimension: d.dimension,
                        score: d.score,
                    })),
                }),
                revisionCount: round.roundNumber,
                episodeId: episode.id,
                langsmithTraceId: round.assessment.langsmithTraceId,
            });
        } catch {
            // Memory not available — continue without recording
            console.warn(
                `[ReviewerLoop] Failed to record revision round ${round.roundNumber} to episodic memory`
            );
        }
    },
    { name: "reviewer.gate.revision.record", run_type: "chain" }
);
