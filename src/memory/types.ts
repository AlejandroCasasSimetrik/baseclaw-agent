/**
 * Level 3 — Memory Layer Types
 *
 * Central type definitions for Working, Episodic, and Semantic memory.
 * Multi-tenant from the start — every type includes tenantId.
 */

import type { AgentType } from "../skills/types.js";

// Re-export for convenience
export type { AgentType } from "../skills/types.js";

// ── Working Memory ─────────────────────────────────────────

/**
 * Ephemeral scratchpad that lives for the duration of one task.
 * NOT shared across agents unless explicitly passed via inter-agent messages.
 */
export interface WorkingMemoryState {
    /** Unique identifier for this task execution */
    taskId: string;

    /** Tenant isolation key */
    tenantId: string;

    /** Human-readable description of the current task */
    taskDescription: string;

    /** Current high-level goal the agent is pursuing */
    currentGoal: string;

    /** Active plan steps — ordered list of steps, with completion status */
    activePlanSteps: PlanStep[];

    /** Recent tool call results (sliding window) */
    recentToolResults: ToolResult[];

    /** MCP call results (sliding window) */
    mcpCallResults: McpResult[];

    /** RAG retrieval results (sliding window) */
    ragResults: RagResult[];

    /** Inter-agent message buffer */
    interAgentMessages: InterAgentMessage[];

    /** Loaded skill definitions for the current task */
    loadedSkillDefinitions: string[];

    /** When this Working Memory was created */
    createdAt: string;

    /** Maximum token budget before sliding window kicks in */
    maxTokenBudget: number;

    /** Estimated current token usage */
    currentTokenEstimate: number;
}

export interface PlanStep {
    id: string;
    description: string;
    status: "pending" | "in_progress" | "completed" | "failed";
}

export interface ToolResult {
    toolName: string;
    input: string;
    output: string;
    timestamp: string;
}

export interface McpResult {
    serverName: string;
    toolName: string;
    input: string;
    output: string;
    timestamp: string;
}

export interface RagResult {
    content: string;
    source: string;
    score: number;
    timestamp: string;
}

export interface InterAgentMessage {
    fromAgent: string;
    toAgent: string;
    content: string;
    timestamp: string;
}

// ── Episodic Memory ────────────────────────────────────────

/** Input for creating a new episode (pre-DB fields like id/createdAt are auto-generated) */
export interface EpisodeInput {
    agentType: AgentType;
    taskDescription: string;
    outcome: string;
    durationMs: number;
    langsmithTraceId: string;
    metadata?: Record<string, unknown>;
}

/** Full episode record as stored in PostgreSQL */
export interface EpisodeRecord extends EpisodeInput {
    id: string;
    tenantId: string;
    createdAt: Date;
}

export interface DecisionInput {
    agentType: string;
    reasoning: string;
    contextSnapshot: Record<string, unknown>;
    episodeId: string;
    langsmithTraceId: string;
}

export interface HitlEventInput {
    reason: string;
    userResponse?: string;
    resolution?: string;
    agentType: string;
    /** Level 9: always "reviewer" — enforced at code level */
    triggeredBy?: string;
    /** Level 9: snapshot of data presented to the user */
    contextSnapshot?: Record<string, unknown>;
    /** Level 9: how long the system was paused (ms) */
    pauseDuration?: number;
    episodeId: string;
    langsmithTraceId: string;
}

export interface FileUploadInput {
    filename: string;
    fileType: string;
    sizeBytes: number;
    parseStatus: string;
    chunkCount: number;
    episodeId: string;
    langsmithTraceId: string;
}

export interface FeedbackLoopInput {
    sourceAgent: string;
    targetAgent: string;
    feedbackContent: string;
    revisionCount: number;
    episodeId: string;
    langsmithTraceId: string;
}

export interface SubAgentEventInput {
    parentAgent: string;
    subAgentType: string;
    subAgentId?: string;       // Level 8: unique sub-agent ID
    parentAgentId?: string;    // Level 8: parent's unique ID
    task: string;
    result?: string;
    eventType: "spawn" | "dissolve";
    durationMs?: number;       // Level 8: execution duration
    episodeId: string;
    langsmithTraceId: string;
}

export interface McpUsageInput {
    serverName: string;
    toolName: string;
    inputSummary: string;
    outputSummary: string;
    latencyMs: number;
    episodeId: string;
    langsmithTraceId: string;
}

// ── Voice Event Inputs (Level 7) ──────────────────────────

export interface STTEventInput {
    audioFormat: string;
    audioDurationMs: number | null;
    audioSizeBytes: number;
    provider: string;
    transcriptionText: string | null;
    confidenceScore: string | null;
    latencyMs: number;
    success: string;
    errorMessage: string | null;
    episodeId: string;
    langsmithTraceId: string;
}

export interface TTSEventInput {
    inputTextPreview: string;
    voiceId: string;
    modelId: string;
    audioDurationMs: number | null;
    latencyMs: number;
    streamingUsed: string;
    success: string;
    errorMessage: string | null;
    episodeId: string;
    langsmithTraceId: string;
}

// ── Semantic Memory ────────────────────────────────────────

/** Valid Pinecone namespaces */
export type SemanticNamespace = "rag" | "knowledge";

/** Metadata attached to every vector in Pinecone */
export interface SemanticVectorMetadata {
    source: string;
    timestamp: string;
    agentType: string;
    taskId: string;
    tenantId: string;
    namespace: SemanticNamespace;
    /** Index signature required by Pinecone's RecordMetadata */
    [key: string]: string;
}

/** Wrapper for semantic search results */
export interface MemoryQueryResult {
    id: string;
    score: number;
    metadata: SemanticVectorMetadata;
    content?: string;
}

// ── RAG Query ──────────────────────────────────────────────

/** Filter options for queryRAG() — Level 5 */
export interface RAGQueryFilters {
    /** Filter by active phase */
    phase?: string;
    /** Filter by active agent */
    agent?: string;
    /** Filter by file type (extension) */
    fileType?: string;
    /** Filter by source filename */
    sourceFile?: string;
}

// ── Memory Manager ─────────────────────────────────────────

/** Context passed to MemoryManager.loadContext() */
export interface TaskContext {
    taskId: string;
    tenantId: string;
    taskDescription: string;
    agentType: AgentType;
}
