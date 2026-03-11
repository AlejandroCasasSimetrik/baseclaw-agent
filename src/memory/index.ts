/**
 * Level 3 — Memory Layer
 *
 * Barrel export for the entire memory subsystem.
 */

// ── Working Memory ─────────────────────────────────────────
export {
    createWorkingMemory,
    updateWorkingMemory,
    estimateTokens,
    enforceTokenBudget,
    clearWorkingMemory,
} from "./working-memory.js";

// ── Episodic Memory ────────────────────────────────────────
export { getDb, resetDb } from "./episodic/db.js";
export {
    episodes,
    decisions,
    hitlEvents,
    fileUploads,
    feedbackLoops,
    subAgentEvents,
    mcpUsage,
    sttEvents,
    ttsEvents,
    voiceConfig,
    allTables,
    COMMON_COLUMNS,
} from "./episodic/schema.js";
export {
    insertEpisode,
    getRecentEpisodes,
    getEpisodesByAgent,
    getEpisodesByTask,
    searchEpisodes,
    getEpisodeById,
    insertDecision,
    insertHitlEvent,
    insertFileUpload,
    insertFeedbackLoop,
    insertSubAgentEvent,
    insertMcpUsage,
    insertSTTEvent,
    getSTTEvents,
    insertTTSEvent,
    getTTSEvents,
} from "./episodic/queries.js";

// ── Semantic Memory ────────────────────────────────────────
export {
    getPineconeClient,
    resetPineconeClient,
    getIndex,
    getNamespace,
    upsertToKnowledge,
    querySemanticMemory,
    deleteFromKnowledge,
    generateEmbedding,
} from "./semantic/pinecone.js";

// ── Memory Manager ─────────────────────────────────────────
export { MemoryManager } from "./manager.js";

// ── Types ──────────────────────────────────────────────────
export type {
    WorkingMemoryState,
    PlanStep,
    ToolResult,
    McpResult,
    RagResult,
    InterAgentMessage,
    EpisodeInput,
    EpisodeRecord,
    DecisionInput,
    HitlEventInput,
    FileUploadInput,
    FeedbackLoopInput,
    SubAgentEventInput,
    McpUsageInput,
    STTEventInput,
    TTSEventInput,
    SemanticNamespace,
    SemanticVectorMetadata,
    MemoryQueryResult,
    TaskContext,
    RAGQueryFilters,
} from "./types.js";
