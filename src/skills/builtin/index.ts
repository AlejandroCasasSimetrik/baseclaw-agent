import type { SkillRegistry } from "../registry.js";
import { ideationSkills } from "./ideation.js";
import { planningSkills } from "./planning.js";
import { executionSkills } from "./execution.js";
import { reviewerSkills } from "./reviewer.js";
import { sharedSkills } from "./shared.js";
import { conversationSkills } from "./conversation.js";

/**
 * Register all built-in skills into the given registry.
 *
 * Called at startup to load the default skill set.
 * Skills are registered but NOT loaded into any agent's context
 * until a task activates them via the SkillLoader.
 */
export function registerBuiltinSkills(registry: SkillRegistry): void {
    const allBuiltinSkills = [
        ...ideationSkills,
        ...planningSkills,
        ...executionSkills,
        ...reviewerSkills,
        ...sharedSkills,
        ...conversationSkills,
    ];

    for (const skill of allBuiltinSkills) {
        registry.register(skill);
    }
}

// Re-export individual skill arrays for testing
export { ideationSkills } from "./ideation.js";
export { planningSkills } from "./planning.js";
export { executionSkills } from "./execution.js";
export { reviewerSkills } from "./reviewer.js";
export { sharedSkills } from "./shared.js";
export { conversationSkills } from "./conversation.js";
