import type { TaskRegistry } from "../registry.js";
import { ideationTasks } from "./ideation.js";
import { planningTasks } from "./planning.js";
import { executionTasks } from "./execution.js";
import { reviewerTasks } from "./reviewer.js";

/**
 * Register all built-in tasks into the given registry.
 *
 * Called at startup to load the default task library.
 * Tasks are registered but NOT activated until a plan uses them.
 */
export function registerBuiltinTasks(registry: TaskRegistry): void {
    const allBuiltinTasks = [
        ...ideationTasks,
        ...planningTasks,
        ...executionTasks,
        ...reviewerTasks,
    ];

    for (const task of allBuiltinTasks) {
        registry.register(task);
    }
}

// Re-export individual task arrays for testing
export { ideationTasks } from "./ideation.js";
export { planningTasks } from "./planning.js";
export { executionTasks } from "./execution.js";
export { reviewerTasks } from "./reviewer.js";
