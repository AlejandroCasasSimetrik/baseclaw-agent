import type { BaseMessage } from "@langchain/core/messages";
import type { AgentType } from "../skills/types.js";

// ── Task Context & Result ────────────────────────────────────
/**
 * Context passed to a task handler when it executes.
 */
export interface TaskContext {
    taskContext: string;
    agentType: AgentType;
    messages: BaseMessage[];
    params: Record<string, unknown>;
}

/**
 * Result returned by a task handler after execution.
 */
export interface TaskResult {
    output: string;
    status: "success" | "failed" | "needs_review";
    metadata?: Record<string, unknown>;
}

// ── Task Function Types ──────────────────────────────────────
/**
 * Handler function — the task's core logic.
 * If not provided, the agent handles execution via LLM with task context.
 */
export type TaskHandler = (context: TaskContext) => Promise<TaskResult>;

/**
 * Relevance scorer — determines if a task should be suggested for a given context.
 * Returns a score from 0.0 (irrelevant) to 1.0 (highly relevant).
 */
export type TaskRelevanceScorer = (
    agentType: AgentType,
    taskContext: string
) => number;

// ── Task Definition ──────────────────────────────────────────
/**
 * Complete definition of a task — the atomic unit of productivity.
 *
 * Tasks declare what skills and tools they need. When a task executes,
 * its required skills are loaded and its required tools are attached.
 */
export interface TaskDefinition {
    /** Unique identifier, e.g. "execution.implement-feature" */
    id: string;

    /** Human-readable display name */
    name: string;

    /** Description of what this task accomplishes */
    description: string;

    /** Which agent types can use this task */
    agentTypes: AgentType[];

    /** Skill IDs that must be loaded when this task executes */
    requiredSkills: string[];

    /** MCP tool names or local tool IDs needed */
    requiredTools: string[];

    /** Estimated duration, e.g. "5m", "1h", "1d" */
    estimatedDuration?: string;

    /** Category for organizational grouping */
    category?: string;

    /** What parameters this task accepts */
    inputSchema?: Record<string, unknown>;

    /** What this task produces */
    outputSchema?: Record<string, unknown>;

    /** Optional auto-execution handler */
    handler?: TaskHandler;

    /**
     * System prompt fragment injected into the agent's context
     * when this task is active.
     */
    systemPromptFragment: string;

    /** Determines if this task should be suggested for a given context */
    relevanceScorer: TaskRelevanceScorer;

    /** Extensible metadata slot */
    metadata?: Record<string, unknown>;
}

// ── Plan Types ───────────────────────────────────────────────
/**
 * A single step in a plan — references a TaskDefinition.
 */
export interface TaskStep {
    /** Unique step ID within the plan */
    stepId: string;

    /** References a TaskDefinition.id from the registry */
    taskId: string;

    /** Human-readable task name (denormalized for display) */
    taskName: string;

    /** Parameters to pass to the task */
    params: Record<string, unknown>;

    /** Current execution status */
    status: "pending" | "active" | "done" | "failed" | "skipped";

    /** Result after execution */
    result?: TaskResult;

    /** Step IDs that must complete before this step can start */
    dependencies: string[];
}

/**
 * A structured plan composed of tasks from the registry.
 * Created by the Planning Agent, executed by the Execution Agent.
 */
export interface TaskPlan {
    /** Unique plan ID */
    id: string;

    /** Plan title / summary */
    title: string;

    /** Ordered list of task steps */
    steps: TaskStep[];

    /** Which agent created this plan */
    createdBy: AgentType;

    /** Plan lifecycle status */
    status: "draft" | "approved" | "executing" | "completed" | "failed";

    /** ISO timestamp of plan creation */
    createdAt: string;

    /** ISO timestamp of last update */
    updatedAt: string;
}

// ── Task Load Result ─────────────────────────────────────────
/**
 * Represents a task that was evaluated during loading.
 * Used for tracing — shows what was considered and why.
 */
export interface TaskLoadResult {
    taskId: string;
    taskName: string;
    relevanceScore: number;
    loaded: boolean;
    reason: string;
}

// Re-export AgentType for convenience
export type { AgentType } from "../skills/types.js";
