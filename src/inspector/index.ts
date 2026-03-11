/**
 * Inspector Module — Public API
 *
 * Central export point for the dev console inspector system.
 */

// ── Event Bus ────────────────────────────────────────────────
export {
    InspectorEventBus,
    inspectorBus,
} from "./event-bus.js";

export type {
    InspectorEventType,
    SkillEventType,
    MCPEventType,
    MemoryEventType,
    InspectorEvent,
    SkillRegisteredEvent,
    SkillUnregisteredEvent,
    SkillLoadedEvent,
    SkillUnloadedEvent,
    SkillRelevanceScoredEvent,
    MCPRegisteredEvent,
    MCPUnregisteredEvent,
    MCPConnectedEvent,
    MCPDisconnectedEvent,
    MCPToolDiscoveredEvent,
    MCPToolCalledEvent,
    WorkingMemoryLoadedEvent,
    WorkingMemoryClearedEvent,
    EpisodeWrittenEvent,
    SemanticQueryEvent,
    SemanticWriteEvent,
    MemoryHitlEvent,
    MemoryFeedbackLoopEvent,
} from "./event-bus.js";

// ── Memory Timeline ──────────────────────────────────────────
export {
    recordTimelineEvent,
    getTimelineEvents,
    clearTimeline,
    getTimelineCount,
} from "./memory-timeline.js";

export type {
    MemoryLayer,
    TimelineEntry,
} from "./memory-timeline.js";

// ── Sanitizer ────────────────────────────────────────────────
export {
    sanitizeUrl,
    sanitizeMCPConfig,
    sanitizeString,
    sanitizeObject,
    sanitizeToolCallInput,
    summarizeToolOutput,
} from "./sanitizer.js";
