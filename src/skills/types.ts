import type { BaseMessage } from "@langchain/core/messages";

// ── Agent Types ──────────────────────────────────────────────
/**
 * All agent types in the Base Claw system.
 * Used by skills to declare which agents they're available to.
 */
export type AgentType =
    | "conversation"
    | "ideation"
    | "planning"
    | "execution"
    | "reviewer";

// ── Skill Context & Result ───────────────────────────────────
/**
 * Context passed to a skill handler when it executes.
 */
export interface SkillContext {
    taskContext: string;
    agentType: AgentType;
    messages: BaseMessage[];
}

/**
 * Result returned by a skill handler after execution.
 */
export interface SkillResult {
    output: string;
    metadata?: Record<string, unknown>;
}

// ── Skill Function Types ─────────────────────────────────────
/**
 * Handler function — the skill's core logic.
 * Receives task context, returns structured output.
 */
export type SkillHandler = (context: SkillContext) => Promise<SkillResult>;

/**
 * Relevance scorer — determines if a skill should load for a given task.
 * Returns a score from 0.0 (irrelevant) to 1.0 (highly relevant).
 */
export type RelevanceScorer = (
    agentType: AgentType,
    taskContext: string
) => number;

// ── Skill Definition ─────────────────────────────────────────
/**
 * Complete definition of a skill — built-in or custom.
 *
 * There is NO architectural difference between built-in and custom
 * skills at runtime. Both implement this exact interface.
 */
export interface SkillDefinition {
    /** Unique identifier, e.g. "ideation.question-generation" */
    id: string;

    /** Human-readable display name */
    name: string;

    /** Description of what this skill does */
    description: string;

    /** Which agent types can use this skill */
    agentTypes: AgentType[];

    /** The skill's execution function */
    handler: SkillHandler;

    /** Determines if this skill should load for a given task */
    relevanceScorer: RelevanceScorer;

    /**
     * System prompt fragment injected into the agent's context
     * when this skill is loaded. Should be self-contained instructions.
     */
    systemPromptFragment: string;

    /** Optional category for organizational grouping */
    category?: string;

    /**
     * Extensible metadata slot.
     * Reserved for future use (Level 7 inheritance, versioning, etc.)
     */
    metadata?: Record<string, unknown>;
}

// ── Loaded Skill Tracking ────────────────────────────────────
/**
 * Represents a skill that was evaluated during loading.
 * Used for tracing — shows what was considered and why.
 */
export interface SkillLoadResult {
    skillId: string;
    skillName: string;
    relevanceScore: number;
    loaded: boolean;
    reason: string;
}
