-- Level 3 — Episodic Memory Migration
-- Creates all 7 tables for structured, append-only logging.
-- Multi-tenant: every table has a tenant_id column with index.

-- ── Episodes ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "episodes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL,
    "agent_type" text NOT NULL,
    "task_description" text NOT NULL,
    "outcome" text NOT NULL,
    "duration_ms" integer NOT NULL,
    "langsmith_trace_id" text NOT NULL,
    "metadata" jsonb,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_episodes_tenant_id" ON "episodes" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_episodes_created_at" ON "episodes" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_episodes_agent_type" ON "episodes" ("agent_type");

-- ── Decisions ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "decisions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL,
    "agent_type" text NOT NULL,
    "reasoning" text NOT NULL,
    "context_snapshot" jsonb NOT NULL,
    "episode_id" uuid NOT NULL REFERENCES "episodes" ("id"),
    "langsmith_trace_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_decisions_tenant_id" ON "decisions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_decisions_created_at" ON "decisions" ("created_at");

-- ── HITL Events ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "hitl_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL,
    "reason" text NOT NULL,
    "user_response" text,
    "resolution" text,
    "agent_type" text NOT NULL,
    "episode_id" uuid NOT NULL REFERENCES "episodes" ("id"),
    "langsmith_trace_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_hitl_events_tenant_id" ON "hitl_events" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_hitl_events_created_at" ON "hitl_events" ("created_at");

-- ── File Uploads ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "file_uploads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL,
    "filename" text NOT NULL,
    "file_type" text NOT NULL,
    "size_bytes" integer NOT NULL,
    "parse_status" text NOT NULL,
    "chunk_count" integer NOT NULL,
    "episode_id" uuid NOT NULL REFERENCES "episodes" ("id"),
    "langsmith_trace_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_file_uploads_tenant_id" ON "file_uploads" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_file_uploads_created_at" ON "file_uploads" ("created_at");

-- ── Feedback Loops ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "feedback_loops" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL,
    "source_agent" text NOT NULL,
    "target_agent" text NOT NULL,
    "feedback_content" text NOT NULL,
    "revision_count" integer NOT NULL,
    "episode_id" uuid NOT NULL REFERENCES "episodes" ("id"),
    "langsmith_trace_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_feedback_loops_tenant_id" ON "feedback_loops" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_feedback_loops_created_at" ON "feedback_loops" ("created_at");

-- ── Sub-Agent Events ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS "sub_agent_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL,
    "parent_agent" text NOT NULL,
    "sub_agent_type" text NOT NULL,
    "task" text NOT NULL,
    "result" text,
    "event_type" text NOT NULL,
    "episode_id" uuid NOT NULL REFERENCES "episodes" ("id"),
    "langsmith_trace_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_sub_agent_events_tenant_id" ON "sub_agent_events" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sub_agent_events_created_at" ON "sub_agent_events" ("created_at");

-- ── MCP Usage ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "mcp_usage" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" uuid NOT NULL,
    "server_name" text NOT NULL,
    "tool_name" text NOT NULL,
    "input_summary" text NOT NULL,
    "output_summary" text NOT NULL,
    "latency_ms" integer NOT NULL,
    "episode_id" uuid NOT NULL REFERENCES "episodes" ("id"),
    "langsmith_trace_id" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_mcp_usage_tenant_id" ON "mcp_usage" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_mcp_usage_created_at" ON "mcp_usage" ("created_at");
