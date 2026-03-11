/**
 * Level 3 — Working Memory
 *
 * Ephemeral, per-task scratchpad. Lives only for the duration of one task.
 * NOT persisted. NOT shared across agents unless explicitly passed.
 *
 * Implements a sliding window strategy to prevent context overflow.
 */

import { v4 as uuidv4 } from "uuid";
import type { WorkingMemoryState } from "./types.js";

/** Default max token budget (roughly 100k tokens ≈ 400k chars) */
const DEFAULT_MAX_TOKEN_BUDGET = 100_000;

/**
 * Create a fresh Working Memory for a new task.
 */
export function createWorkingMemory(
    taskId?: string,
    tenantId?: string,
    taskDescription?: string
): WorkingMemoryState {
    return {
        taskId: taskId ?? uuidv4(),
        tenantId: tenantId ?? "",
        taskDescription: taskDescription ?? "",
        currentGoal: "",
        activePlanSteps: [],
        recentToolResults: [],
        mcpCallResults: [],
        ragResults: [],
        interAgentMessages: [],
        loadedSkillDefinitions: [],
        createdAt: new Date().toISOString(),
        maxTokenBudget: DEFAULT_MAX_TOKEN_BUDGET,
        currentTokenEstimate: 0,
    };
}

/**
 * Immutable updater — returns a new WorkingMemoryState with partial updates applied.
 * Never mutates the input.
 */
export function updateWorkingMemory(
    current: WorkingMemoryState,
    partial: Partial<WorkingMemoryState>
): WorkingMemoryState {
    const updated = { ...current, ...partial };
    updated.currentTokenEstimate = estimateTokens(updated);
    return updated;
}

/**
 * Estimate token count for a working memory state.
 * Uses a rough heuristic: stringify → char count / 4.
 */
export function estimateTokens(wm: WorkingMemoryState): number {
    const serialized = JSON.stringify(wm);
    return Math.ceil(serialized.length / 4);
}

/**
 * Enforce token budget by trimming oldest entries first.
 *
 * Trim priority (oldest first):
 * 1. recentToolResults
 * 2. mcpCallResults
 * 3. ragResults
 * 4. interAgentMessages
 *
 * Returns a new WorkingMemoryState (immutable).
 */
export function enforceTokenBudget(
    wm: WorkingMemoryState
): WorkingMemoryState {
    let current = { ...wm };
    current.currentTokenEstimate = estimateTokens(current);

    if (current.currentTokenEstimate <= current.maxTokenBudget) {
        return current;
    }

    // Trim recentToolResults (oldest first)
    while (
        current.recentToolResults.length > 0 &&
        estimateTokens(current) > current.maxTokenBudget
    ) {
        current = {
            ...current,
            recentToolResults: current.recentToolResults.slice(1),
        };
    }

    // Trim mcpCallResults (oldest first)
    while (
        current.mcpCallResults.length > 0 &&
        estimateTokens(current) > current.maxTokenBudget
    ) {
        current = {
            ...current,
            mcpCallResults: current.mcpCallResults.slice(1),
        };
    }

    // Trim ragResults (oldest first)
    while (
        current.ragResults.length > 0 &&
        estimateTokens(current) > current.maxTokenBudget
    ) {
        current = {
            ...current,
            ragResults: current.ragResults.slice(1),
        };
    }

    // Trim interAgentMessages (oldest first)
    while (
        current.interAgentMessages.length > 0 &&
        estimateTokens(current) > current.maxTokenBudget
    ) {
        current = {
            ...current,
            interAgentMessages: current.interAgentMessages.slice(1),
        };
    }

    current.currentTokenEstimate = estimateTokens(current);
    return current;
}

/**
 * Clear working memory — returns a blank state.
 * Called when a task completes.
 */
export function clearWorkingMemory(): WorkingMemoryState {
    return createWorkingMemory();
}
