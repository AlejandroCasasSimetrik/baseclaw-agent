/**
 * Level 9 — Heartbeat Module Exports
 */

export {
    loadHeartbeatConfig,
} from "./types.js";
export type {
    SystemState,
    HeartbeatAction,
    HeartbeatConfig,
    HeartbeatDecision,
    ContinuousTask,
    ContinuousTaskInput,
    ContinuousTaskUpdate,
    TaskStatus,
} from "./types.js";

export {
    detectSystemState,
    incrementActiveInvocations,
    decrementActiveInvocations,
    getActiveInvocationCount,
    resetActiveInvocations,
} from "./state-detector.js";

export { ContinuousTaskManager } from "./task-manager.js";

export {
    HeartbeatScheduler,
    getHeartbeatScheduler,
    resetHeartbeatScheduler,
} from "./scheduler.js";
