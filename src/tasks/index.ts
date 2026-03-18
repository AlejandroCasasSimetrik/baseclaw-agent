/**
 * Tasks Module — Public API
 *
 * Central export point for the entire task system.
 * Import from here rather than individual files.
 */

// ── Types ────────────────────────────────────────────────────
export type {
    TaskDefinition,
    TaskHandler,
    TaskRelevanceScorer,
    TaskContext,
    TaskResult,
    TaskPlan,
    TaskStep,
    TaskLoadResult,
} from "./types.js";

// ── Core Classes ─────────────────────────────────────────────
export { TaskRegistry } from "./registry.js";
export { TaskLoader } from "./loader.js";

// ── Built-in Tasks ───────────────────────────────────────────
export { registerBuiltinTasks } from "./builtin/index.js";
export {
    ideationTasks,
    planningTasks,
    executionTasks,
    reviewerTasks,
} from "./builtin/index.js";
