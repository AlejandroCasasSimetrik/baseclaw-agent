/**
 * Level 10 — Reviewer Loop Module Entry Point
 *
 * Re-exports all public APIs for the mandatory review gate,
 * quality scoring, structured feedback, revision management,
 * mid-execution checkpoints, knowledge distillation, and
 * sub-reviewer spawning.
 */

// ── Types ──────────────────────────────────────────────────
export type {
    ReviewTriggerType,
    QualityDimension,
    DimensionScore,
    ReviewVerdict,
    SystemAwareness,
    QualityAssessment,
    IssueSeverity,
    FeedbackIssue,
    StructuredFeedback,
    RevisionRound,
    CheckpointVerdict,
    CheckpointRequest,
    CheckpointResponse,
    KnowledgeType,
    DistilledKnowledge,
    ReviewerGateState,
} from "./types.js";

export {
    ALL_QUALITY_DIMENSIONS,
    defaultReviewerGateState,
    getReviewConfig,
} from "./types.js";

// ── Quality Scoring ────────────────────────────────────────
export { scoreOutput, determineVerdict, buildSystemAwareness } from "./quality-scorer.js";

// ── Feedback Generation ────────────────────────────────────
export { generateFeedback, formatFeedbackForAgent } from "./feedback-generator.js";

// ── Mandatory Gate ─────────────────────────────────────────
export { reviewerGateNode } from "./mandatory-gate.js";

// ── Checkpoints ────────────────────────────────────────────
export { checkpointWithReviewer, shouldCheckpoint } from "./checkpoint.js";

// ── Revision Management ────────────────────────────────────
export {
    createRevisionRound,
    updateRevisionRoundWithRevision,
    checkStagnation,
    shouldEscalateToHITL,
    formatRevisionHistory,
    getScoreTrend,
    recordRevisionRound,
} from "./revision-manager.js";

// ── Knowledge Distillation ─────────────────────────────────
export { distillKnowledge } from "./knowledge-distillation.js";

// ── Background Distillation ────────────────────────────────
export { runBackgroundDistillation } from "./background-distillation.js";

// ── Sub-Reviewer ───────────────────────────────────────────
export { spawnSubReviewers, REVIEW_FOCUS_AREAS } from "./sub-reviewer.js";
