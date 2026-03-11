CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_type" text NOT NULL,
	"reasoning" text NOT NULL,
	"context_snapshot" jsonb NOT NULL,
	"episode_id" uuid NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_type" text NOT NULL,
	"task_description" text NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_loops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_agent" text NOT NULL,
	"target_agent" text NOT NULL,
	"feedback_content" text NOT NULL,
	"revision_count" integer NOT NULL,
	"episode_id" uuid NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"parse_status" text NOT NULL,
	"chunk_count" integer NOT NULL,
	"episode_id" uuid NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hitl_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"user_response" text,
	"resolution" text,
	"agent_type" text NOT NULL,
	"episode_id" uuid NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"server_name" text NOT NULL,
	"tool_name" text NOT NULL,
	"input_summary" text NOT NULL,
	"output_summary" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"episode_id" uuid NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stt_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"audio_format" text NOT NULL,
	"audio_duration_ms" integer,
	"audio_size_bytes" integer NOT NULL,
	"provider" text NOT NULL,
	"transcription_text" text,
	"confidence_score" text,
	"latency_ms" integer NOT NULL,
	"success" text NOT NULL,
	"error_message" text,
	"episode_id" uuid NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_agent" text NOT NULL,
	"sub_agent_type" text NOT NULL,
	"sub_agent_id" text,
	"parent_agent_id" text,
	"task" text NOT NULL,
	"result" text,
	"event_type" text NOT NULL,
	"duration_ms" integer,
	"episode_id" uuid NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"input_text_preview" text NOT NULL,
	"voice_id" text NOT NULL,
	"model_id" text NOT NULL,
	"audio_duration_ms" integer,
	"latency_ms" integer NOT NULL,
	"streaming_used" text NOT NULL,
	"success" text NOT NULL,
	"error_message" text,
	"episode_id" uuid NOT NULL,
	"langsmith_trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"stt_provider" text NOT NULL,
	"tts_enabled" text NOT NULL,
	"voice_id" text,
	"model_id" text,
	"max_audio_duration_seconds" integer,
	"max_audio_size_bytes" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_config_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_loops" ADD CONSTRAINT "feedback_loops_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitl_events" ADD CONSTRAINT "hitl_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_usage" ADD CONSTRAINT "mcp_usage_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stt_events" ADD CONSTRAINT "stt_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_agent_events" ADD CONSTRAINT "sub_agent_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_events" ADD CONSTRAINT "tts_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;