/**
 * Level 8 — Sub-agent Safety Rules
 *
 * Enforces all safety constraints on sub-agent spawning:
 *   - Max depth = 1 (no recursive spawning)
 *   - Conversation Agent cannot spawn
 *   - Concurrency limits
 *   - Execution timeout enforcement
 *   - Parent cancellation cascade
 */

import type { SubAgentConfig, SubAgentState, SpawnableAgentType } from "./types.js";
import {
    isSpawnableAgentType,
    MAX_SPAWN_DEPTH,
    DEFAULT_CONCURRENCY_LIMIT,
    DEFAULT_TIMEOUT_MS,
} from "./types.js";

// ── Validation ────────────────────────────────────────────

export interface SpawnValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Validate a spawn request against all safety rules.
 *
 * Checks:
 * 1. Agent type is spawnable (not Conversation)
 * 2. Not already a sub-agent (max depth = 1)
 * 3. Concurrency limit not exceeded (returns queuing hint, not rejection)
 */
export function validateSpawnRequest(
    config: SubAgentConfig,
    activeCount: number,
    concurrencyLimit: number = DEFAULT_CONCURRENCY_LIMIT
): SpawnValidationResult {
    // Rule 1: Only 4 main agent types can spawn
    if (!isSpawnableAgentType(config.parentAgentType)) {
        return {
            valid: false,
            error: `Agent type "${config.parentAgentType}" cannot spawn sub-agents. Only ideation, planning, execution, and reviewer agents can spawn.`,
        };
    }

    // Rule 2: Max depth = 1 — sub-agents cannot spawn sub-sub-agents
    if (config.isSubAgent) {
        return {
            valid: false,
            error: `Sub-agents cannot spawn their own sub-agents. Max spawning depth is ${MAX_SPAWN_DEPTH}. This sub-agent is already at depth 1.`,
        };
    }

    // Rule 3: Task must be non-empty
    if (!config.task || config.task.trim().length === 0) {
        return {
            valid: false,
            error: "Sub-agent task must be a non-empty string.",
        };
    }

    // Rule 4: Parent agent ID must be non-empty
    if (!config.parentAgentId || config.parentAgentId.trim().length === 0) {
        return {
            valid: false,
            error: "Parent agent ID must be a non-empty string.",
        };
    }

    // Note: concurrency is handled by the queue, not by validation rejection
    // We just validate the spawn request itself is legal

    return { valid: true };
}

/**
 * Check if more sub-agents can be spawned immediately,
 * or if the request should be queued.
 */
export function shouldQueue(
    activeCount: number,
    concurrencyLimit: number = DEFAULT_CONCURRENCY_LIMIT
): boolean {
    return activeCount >= concurrencyLimit;
}

// ── Timeout Enforcement ───────────────────────────────────

/**
 * Create a timeout controller for a sub-agent.
 *
 * Returns a promise that rejects after `timeoutMs` milliseconds,
 * and a cancel function to clear the timeout on normal completion.
 */
export function createTimeoutController(
    subAgentId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): { timeoutPromise: Promise<never>; cancel: () => void } {
    let timeoutId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(
                new SubAgentTimeoutError(
                    `Sub-agent "${subAgentId}" exceeded execution timeout of ${timeoutMs}ms`,
                    subAgentId,
                    timeoutMs
                )
            );
        }, timeoutMs);
    });

    const cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
    };

    return { timeoutPromise, cancel };
}

/**
 * Custom error for sub-agent timeout.
 */
export class SubAgentTimeoutError extends Error {
    public readonly subAgentId: string;
    public readonly timeoutMs: number;

    constructor(message: string, subAgentId: string, timeoutMs: number) {
        super(message);
        this.name = "SubAgentTimeoutError";
        this.subAgentId = subAgentId;
        this.timeoutMs = timeoutMs;
    }
}

/**
 * Custom error for sub-agent cancellation.
 */
export class SubAgentCancelledError extends Error {
    public readonly subAgentId: string;
    public readonly reason: string;

    constructor(subAgentId: string, reason: string) {
        super(`Sub-agent "${subAgentId}" was cancelled: ${reason}`);
        this.name = "SubAgentCancelledError";
        this.subAgentId = subAgentId;
        this.reason = reason;
    }
}

// ── Cascade Cancel ────────────────────────────────────────

/**
 * Get sub-agent IDs that should be cancelled when a parent is cancelled.
 * Returns IDs of all active (pending or running) sub-agents for the parent.
 */
export function getSubAgentsToCancel(
    parentAgentId: string,
    allSubAgents: SubAgentState[]
): string[] {
    return allSubAgents
        .filter(
            (sa) =>
                sa.parentAgentId === parentAgentId &&
                (sa.status === "pending" || sa.status === "running")
        )
        .map((sa) => sa.id);
}
