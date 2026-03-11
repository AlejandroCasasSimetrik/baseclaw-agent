/**
 * Skills Module — Public API
 *
 * Central export point for the entire skill system.
 * Import from here rather than individual files.
 */

// ── Types ────────────────────────────────────────────────────
export type {
    AgentType,
    SkillDefinition,
    SkillHandler,
    RelevanceScorer,
    SkillContext,
    SkillResult,
    SkillLoadResult,
} from "./types.js";

// ── Core Classes ─────────────────────────────────────────────
export { SkillRegistry } from "./registry.js";
export { SkillLoader } from "./loader.js";

// ── Built-in Skills ──────────────────────────────────────────
export { registerBuiltinSkills } from "./builtin/index.js";
export {
    ideationSkills,
    planningSkills,
    executionSkills,
    reviewerSkills,
    sharedSkills,
} from "./builtin/index.js";

// ── Custom Skills ────────────────────────────────────────────
export { registerCustomSkill, exampleSentimentSkill } from "./custom.js";

// ── Skill-Aware Agent Wrapper ────────────────────────────────
export {
    createSkillAwareAgent,
    formatSkillLoadTrace,
} from "./skill-aware-agent.js";
