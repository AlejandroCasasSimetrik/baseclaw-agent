/**
 * Level 9 — Heartbeat Types
 *
 * Type definitions for the proactive heartbeat execution loop
 * and the Continuous Task List.
 */

// ── System State ───────────────────────────────────────────

/**
 * The three possible system states detected by the heartbeat.
 *
 * - executing: any main agent or sub-agent is actively running
 * - idle: no agents running, no sub-agents running, no HITL pending
 * - waiting: a HITL request is pending (Reviewer flagged, user hasn't responded)
 */
export type SystemState = "executing" | "idle" | "waiting";

/**
 * The action the heartbeat takes based on detected state.
 */
export type HeartbeatAction = "continue" | "pull_task" | "wait";

// ── Heartbeat Config ───────────────────────────────────────

export interface HeartbeatConfig {
    /** Interval in milliseconds between heartbeat fires. Default: 300000 (5 min) */
    intervalMs: number;
    /** Global enable/disable toggle. Default: true */
    enabled: boolean;
    /** Max time a heartbeat-triggered task can run before timeout. Default: 3600000 (1 hour) */
    maxTaskDurationMs: number;
}

/**
 * Load heartbeat config from environment variables with defaults.
 */
export function loadHeartbeatConfig(): HeartbeatConfig {
    return {
        intervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? "300000", 10),
        enabled: process.env.HEARTBEAT_ENABLED !== "false",
        maxTaskDurationMs: parseInt(
            process.env.HEARTBEAT_MAX_TASK_DURATION_MS ?? "3600000",
            10
        ),
    };
}

// ── Heartbeat Decision ─────────────────────────────────────

export interface HeartbeatDecision {
    /** Detected system state */
    state: SystemState;
    /** Action taken by the heartbeat */
    action: HeartbeatAction;
    /** If a task was pulled, its ID */
    taskId?: string;
    /** If a task was pulled, its title */
    taskTitle?: string;
    /** Agent the task was routed to */
    routedToAgent?: string;
    /** Human-readable reason for the decision */
    reason: string;
    /** Timestamp of the heartbeat fire */
    timestamp: string;
}

// ── Continuous Task List ───────────────────────────────────

export type TaskStatus = "queued" | "in_progress" | "completed" | "failed";

export interface ContinuousTask {
    id: string;
    tenantId: string;
    title: string;
    description: string;
    priority: number;
    status: TaskStatus;
    assignedAgent: string; // agent type or "auto"
    result: string | null;
    langsmithTraceId: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
}

export interface ContinuousTaskInput {
    title: string;
    description: string;
    priority?: number;
    assignedAgent?: string;
}

export interface ContinuousTaskUpdate {
    title?: string;
    description?: string;
    priority?: number;
    assignedAgent?: string;
}
