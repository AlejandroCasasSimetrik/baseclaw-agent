/**
 * Level 8 — Sub-agent Spawning
 *
 * Barrel export for the sub-agent module.
 *
 * Sub-agents are first-class execution units. Any of the 4 main agents
 * (Ideation, Planning, Execution, Reviewer) can spawn sub-agents of
 * their own type to handle parallel or specialized tasks.
 */

// ── Types ──────────────────────────────────────────────────
export type {
    SpawnableAgentType,
    SubAgentStatus,
    SubAgentConfig,
    SubAgentState,
    SubAgentResult,
    SubAgentResultMetadata,
    SubAgentTraceMetadata,
} from "./types.js";

export {
    isSpawnableAgentType,
    buildSubAgentTraceMetadata,
    MAX_SPAWN_DEPTH,
    DEFAULT_CONCURRENCY_LIMIT,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_ITERATIONS,
} from "./types.js";

// ── Lifecycle ──────────────────────────────────────────────
export {
    spawnSubAgent,
    executeSubAgent,
    dissolveSubAgent,
    cancelSubAgent,
    cascadeCancelSubAgents,
    runSubAgent,
    configureSubAgentLifecycle,
    getSpawnQueue,
} from "./lifecycle.js";

// ── Registry ───────────────────────────────────────────────
export {
    SubAgentRegistry,
    getSubAgentRegistry,
    resetSubAgentRegistry,
} from "./registry.js";

// ── Coordinator ────────────────────────────────────────────
export {
    SubAgentQueue,
    collectResultsAsCompleted,
    collectAllResults,
} from "./coordinator.js";

// ── Safety ─────────────────────────────────────────────────
export {
    validateSpawnRequest,
    shouldQueue,
    createTimeoutController,
    SubAgentTimeoutError,
    SubAgentCancelledError,
    getSubAgentsToCancel,
} from "./safety.js";

// ── Inheritance ────────────────────────────────────────────
export {
    inheritSkills,
    loadAdditionalSkills,
    inheritMCPServers,
    cleanupMCPInheritance,
    getParentMCPServerIds,
} from "./inheritance.js";
