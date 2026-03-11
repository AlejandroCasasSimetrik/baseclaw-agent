/**
 * Level 10 — Reviewer Loop Types
 *
 * Central type definitions for the mandatory review gate, quality scoring,
 * structured feedback, revision management, mid-execution checkpoints,
 * and knowledge distillation.
 *
 * The Reviewer Loop is the quality control layer of the entire system.
 * Every agent output passes through it before reaching the user.
 */

import type { AgentType } from "../skills/types.js";

// Re-export for convenience
export type { AgentType } from "../skills/types.js";

// ── Review Triggers ────────────────────────────────────────

/**
 * What caused the review to be triggered.
 */
export type ReviewTriggerType =
    | "mandatory_gate"    // Every agent completion (automatic)
    | "checkpoint"        // Mid-execution checkpoint
    | "agent_requested"   // Agent explicitly requested review
    | "user_requested";   // User asked for a review

// ── Quality Dimensions ─────────────────────────────────────

/**
 * The six quality dimensions scored by the Reviewer.
 */
export type QualityDimension =
    | "accuracy"
    | "completeness"
    | "clarity"
    | "relevance"
    | "safety"
    | "alignment";

export const ALL_QUALITY_DIMENSIONS: QualityDimension[] = [
    "accuracy",
    "completeness",
    "clarity",
    "relevance",
    "safety",
    "alignment",
];

/**
 * Individual dimension score.
 */
export interface DimensionScore {
    dimension: QualityDimension;
    score: number; // 0-100
    reasoning: string;
}

// ── Review Verdict ─────────────────────────────────────────

export type ReviewVerdict = "approved" | "needs_revision" | "needs_hitl";

// ── System Awareness ───────────────────────────────────────

/**
 * The Reviewer's snapshot of the broader system state.
 * Detects drift, contradiction, scope creep, risk accumulation.
 */
export interface SystemAwareness {
    /** What other agents are currently doing */
    activeAgents: string[];
    /** Active sub-agents */
    activeSubAgents: string[];
    /** Current items in the Continuous Task List */
    pendingTasks: number;
    /** Detected issues */
    driftDetected: boolean;
    contradictionDetected: boolean;
    scopeCreepDetected: boolean;
    riskAccumulation: boolean;
    /** Summary of observations */
    observations: string;
}

// ── Quality Assessment ─────────────────────────────────────

/**
 * The full quality assessment produced by the Reviewer for every review.
 */
export interface QualityAssessment {
    /** Unique ID for this assessment */
    reviewId: string;
    /** 0-100 overall quality score */
    overallScore: number;
    /** Individual dimension scores */
    dimensions: DimensionScore[];
    /** The verdict: approved, needs_revision, or needs_hitl */
    verdict: ReviewVerdict;
    /** 0-100 confidence in the assessment */
    confidence: number;
    /** System state awareness snapshot */
    systemAwareness: SystemAwareness;
    /** What triggered this review */
    triggerType: ReviewTriggerType;
    /** Which agent produced the output */
    sourceAgent: AgentType;
    /** The original task/goal */
    taskContext: string;
    /** Timestamp */
    timestamp: string;
    /** LangSmith trace ID */
    langsmithTraceId: string;
}

// ── Structured Feedback ────────────────────────────────────

export type IssueSeverity = "critical" | "major" | "minor";

/**
 * A single issue found during review.
 */
export interface FeedbackIssue {
    /** Which quality dimension this falls under */
    dimension: QualityDimension;
    /** How severe the issue is */
    severity: IssueSeverity;
    /** Clear description of the issue */
    description: string;
    /** Specific suggestion for how to fix it */
    suggestion: string;
    /** Optional reference to RAG/Semantic Memory content */
    reference?: string;
}

/**
 * Structured feedback sent to the target agent when verdict is "needs_revision".
 */
export interface StructuredFeedback {
    /** Which agent should revise */
    targetAgent: AgentType;
    /** Specific issues found */
    issues: FeedbackIssue[];
    /** What aspects of the output are good and should be kept */
    retain: string[];
    /** How many more revision attempts are allowed */
    maxRevisionsRemaining: number;
    /** The quality assessment that produced this feedback */
    reviewId: string;
    /** Timestamp */
    timestamp: string;
}

// ── Revision History ───────────────────────────────────────

/**
 * A single revision round in the feedback loop.
 */
export interface RevisionRound {
    /** Round number (1-indexed) */
    roundNumber: number;
    /** The output that was reviewed */
    originalOutput: string;
    /** The quality assessment for this round */
    assessment: QualityAssessment;
    /** The feedback given (null if approved) */
    feedback: StructuredFeedback | null;
    /** The revised output (null if this was the final round) */
    revisedOutput: string | null;
    /** Timestamp */
    timestamp: string;
}

// ── Mid-Execution Checkpoints ──────────────────────────────

export type CheckpointVerdict = "continue" | "adjust" | "pause";

/**
 * Progress update sent by an agent during a checkpoint.
 */
export interface CheckpointRequest {
    /** What has been done so far */
    progressSummary: string;
    /** What the agent plans to do next */
    plannedNextSteps: string;
    /** Any concerns or uncertainties */
    concerns: string[];
    /** Agent type */
    agentType: AgentType;
    /** Current step number */
    stepNumber: number;
    /** Tenant ID */
    tenantId: string;
    /** Task context */
    taskContext: string;
}

/**
 * The Reviewer's response to a checkpoint.
 */
export interface CheckpointResponse {
    /** The verdict */
    verdict: CheckpointVerdict;
    /** Guidance if verdict is "adjust" */
    guidance?: string;
    /** Reason if verdict is "pause" (used for HITL context) */
    reason?: string;
    /** Timestamp */
    timestamp: string;
}

// ── Knowledge Distillation ─────────────────────────────────

export type KnowledgeType = "pattern" | "anti_pattern" | "criteria" | "template";

/**
 * A distilled knowledge entry produced by the Reviewer.
 */
export interface DistilledKnowledge {
    /** The content/insight */
    content: string;
    /** Type of knowledge */
    knowledgeType: KnowledgeType;
    /** Which agent types this is most relevant to */
    agentRelevance: AgentType[];
    /** Source review and task */
    sourceTaskId: string;
    sourceReviewId: string;
    /** Tenant scope */
    tenantId: string;
    /** Timestamp */
    timestamp: string;
}

// ── Reviewer Gate State (for LangGraph) ────────────────────

/**
 * State tracked by the reviewerGate node across revision cycles.
 */
export interface ReviewerGateState {
    /** Whether a review is currently in progress */
    active: boolean;
    /** The source agent that produced the output under review */
    sourceAgent: AgentType | null;
    /** Current revision round (0 = first review) */
    revisionCount: number;
    /** History of revision rounds for the current task */
    revisionHistory: RevisionRound[];
    /** Current review ID */
    currentReviewId: string | null;
    /** What triggered the current review */
    triggerType: ReviewTriggerType | null;
    /** The structured feedback for the current revision (if any) */
    pendingFeedback: StructuredFeedback | null;
}

/**
 * Default (inactive) reviewer gate state.
 */
export function defaultReviewerGateState(): ReviewerGateState {
    return {
        active: false,
        sourceAgent: null,
        revisionCount: 0,
        revisionHistory: [],
        currentReviewId: null,
        triggerType: null,
        pendingFeedback: null,
    };
}

// ── Config (from .env) ─────────────────────────────────────

/**
 * Read review thresholds from environment.
 */
export function getReviewConfig() {
    return {
        autoApproveThreshold: parseInt(
            process.env.REVIEW_AUTO_APPROVE_THRESHOLD ?? "85",
            10
        ),
        hitlThreshold: parseInt(
            process.env.REVIEW_HITL_THRESHOLD ?? "40",
            10
        ),
        maxRevisionRounds: parseInt(
            process.env.MAX_REVISION_ROUNDS ?? "3",
            10
        ),
        checkpointInterval: parseInt(
            process.env.REVIEW_CHECKPOINT_INTERVAL ?? "3",
            10
        ),
    };
}
