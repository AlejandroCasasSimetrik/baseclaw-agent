/**
 * Level 3 — Episodic Memory Schema (Drizzle ORM)
 *
 * 7 PostgreSQL tables for structured, append-only logging.
 * Every table includes: id (UUID PK), tenantId, createdAt, langsmithTraceId.
 * Multi-tenant by design.
 */

import {
    pgTable,
    uuid,
    text,
    timestamp,
    integer,
    jsonb,
} from "drizzle-orm/pg-core";

// ── Episodes ───────────────────────────────────────────────

export const episodes = pgTable("episodes", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    agentType: text("agent_type").notNull(),
    taskDescription: text("task_description").notNull(),
    outcome: text("outcome").notNull(),
    durationMs: integer("duration_ms").notNull(),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── Decisions ──────────────────────────────────────────────

export const decisions = pgTable("decisions", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    agentType: text("agent_type").notNull(),
    reasoning: text("reasoning").notNull(),
    contextSnapshot: jsonb("context_snapshot").notNull(),
    episodeId: uuid("episode_id")
        .notNull()
        .references(() => episodes.id),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── HITL Events ────────────────────────────────────────────

export const hitlEvents = pgTable("hitl_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reason: text("reason").notNull(),
    userResponse: text("user_response"),
    resolution: text("resolution"),
    agentType: text("agent_type").notNull(),
    // Level 9 — Enhanced HITL fields
    triggeredBy: text("triggered_by").notNull().default("reviewer"),
    contextSnapshot: jsonb("context_snapshot"),
    pauseDuration: integer("pause_duration"), // milliseconds
    episodeId: uuid("episode_id")
        .notNull()
        .references(() => episodes.id),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── File Uploads ───────────────────────────────────────────

export const fileUploads = pgTable("file_uploads", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    filename: text("filename").notNull(),
    fileType: text("file_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    parseStatus: text("parse_status").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    episodeId: uuid("episode_id"),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── Feedback Loops ─────────────────────────────────────────

export const feedbackLoops = pgTable("feedback_loops", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sourceAgent: text("source_agent").notNull(),
    targetAgent: text("target_agent").notNull(),
    feedbackContent: text("feedback_content").notNull(),
    revisionCount: integer("revision_count").notNull(),
    episodeId: uuid("episode_id")
        .notNull()
        .references(() => episodes.id),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── Sub-Agent Events ───────────────────────────────────────

export const subAgentEvents = pgTable("sub_agent_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    parentAgent: text("parent_agent").notNull(),
    subAgentType: text("sub_agent_type").notNull(),
    subAgentId: text("sub_agent_id"),    // Level 8: unique sub-agent ID
    parentAgentId: text("parent_agent_id"), // Level 8: parent's unique ID
    task: text("task").notNull(),
    result: text("result"),
    eventType: text("event_type").notNull(), // 'spawn' | 'dissolve'
    durationMs: integer("duration_ms"),      // Level 8: execution duration
    episodeId: uuid("episode_id")
        .notNull()
        .references(() => episodes.id),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── MCP Usage ──────────────────────────────────────────────

export const mcpUsage = pgTable("mcp_usage", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    serverName: text("server_name").notNull(),
    toolName: text("tool_name").notNull(),
    inputSummary: text("input_summary").notNull(),
    outputSummary: text("output_summary").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    episodeId: uuid("episode_id")
        .notNull()
        .references(() => episodes.id),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── STT Events (Level 7) ──────────────────────────────────

export const sttEvents = pgTable("stt_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    audioFormat: text("audio_format").notNull(),
    audioDurationMs: integer("audio_duration_ms"),
    audioSizeBytes: integer("audio_size_bytes").notNull(),
    provider: text("provider").notNull(),
    transcriptionText: text("transcription_text"),
    confidenceScore: text("confidence_score"), // stored as text to handle null/decimal
    latencyMs: integer("latency_ms").notNull(),
    success: text("success").notNull(), // 'true' | 'false'
    errorMessage: text("error_message"),
    episodeId: uuid("episode_id")
        .notNull()
        .references(() => episodes.id),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── TTS Events (Level 7) ──────────────────────────────────

export const ttsEvents = pgTable("tts_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    inputTextPreview: text("input_text_preview").notNull(),
    voiceId: text("voice_id").notNull(),
    modelId: text("model_id").notNull(),
    audioDurationMs: integer("audio_duration_ms"),
    latencyMs: integer("latency_ms").notNull(),
    streamingUsed: text("streaming_used").notNull(), // 'true' | 'false'
    success: text("success").notNull(), // 'true' | 'false'
    errorMessage: text("error_message"),
    episodeId: uuid("episode_id")
        .notNull()
        .references(() => episodes.id),
    langsmithTraceId: text("langsmith_trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── Voice Config (Level 7) ─────────────────────────────────

export const voiceConfig = pgTable("voice_config", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().unique(),
    sttProvider: text("stt_provider").notNull(),
    ttsEnabled: text("tts_enabled").notNull(), // 'true' | 'false' — Drizzle pg boolean alt
    voiceId: text("voice_id"),
    modelId: text("model_id"),
    maxAudioDurationSeconds: integer("max_audio_duration_seconds"),
    maxAudioSizeBytes: integer("max_audio_size_bytes"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── Continuous Tasks (Level 9) ─────────────────────────────

export const continuousTasks = pgTable("continuous_tasks", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: integer("priority").notNull().default(100),
    status: text("status").notNull().default("queued"), // queued | in_progress | completed | failed
    assignedAgent: text("assigned_agent").notNull().default("auto"),
    result: text("result"),
    langsmithTraceId: text("langsmith_trace_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ── Heartbeat Lock (Level 9) ──────────────────────────────

export const heartbeatLock = pgTable("heartbeat_lock", {
    id: uuid("id").defaultRandom().primaryKey(),
    lockHolder: text("lock_holder").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * All schema tables exported as a bundle for Drizzle Kit and tests.
 */
export const allTables = {
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
    continuousTasks,
    heartbeatLock,
} as const;

/**
 * Common columns present on every table.
 * Used by tests to validate schema completeness.
 */
export const COMMON_COLUMNS = [
    "id",
    "tenant_id",
    "created_at",
    "langsmith_trace_id",
] as const;
