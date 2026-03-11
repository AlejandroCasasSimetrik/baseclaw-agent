/**
 * Level 4 — Dashboard Configuration
 *
 * Defines structured dashboard configs for each agent plus a
 * System Overview. These configs serve as the contract for what
 * each dashboard should display in LangSmith.
 *
 * Dashboards are created/managed via LangSmith UI or API.
 * This module provides the definitions and a setup helper.
 */

import type { AgentType } from "../skills/types.js";

// ── Types ───────────────────────────────────────────────────

export interface MetricDefinition {
    /** Machine-readable metric key */
    key: string;
    /** Human-readable label */
    label: string;
    /** How it's computed */
    type: "count" | "average" | "p50" | "p95" | "p99" | "rate" | "sum" | "distribution";
    /** Optional filter expression */
    filter?: string;
    /** Unit of measurement */
    unit?: string;
}

export interface DashboardConfig {
    /** Dashboard identifier */
    id: string;
    /** Display name */
    title: string;
    /** Description */
    description: string;
    /** Agent type this dashboard covers (null for system-wide) */
    agentType: AgentType | "system" | null;
    /** Metrics displayed on this dashboard */
    metrics: MetricDefinition[];
}

// ── Per-Agent Dashboard Definitions ─────────────────────────

export const CONVERSATION_DASHBOARD: DashboardConfig = {
    id: "dashboard-conversation",
    title: "Conversation Agent",
    description: "Metrics for the Conversation Agent — user-facing gateway",
    agentType: "conversation",
    metrics: [
        { key: "input_count", label: "Input Count", type: "count", unit: "messages" },
        { key: "routing_decisions", label: "Routing Decisions Distribution", type: "distribution" },
        { key: "avg_response_time", label: "Average Response Time", type: "average", unit: "ms" },
        { key: "error_rate", label: "Error Rate", type: "rate", unit: "%" },
        { key: "stt_call_count", label: "STT Call Count", type: "count", unit: "calls" },
        { key: "tts_call_count", label: "TTS Call Count", type: "count", unit: "calls" },
        { key: "avg_stt_latency", label: "Average STT Latency", type: "average", unit: "ms" },
        { key: "avg_tts_latency", label: "Average TTS Latency", type: "average", unit: "ms" },
    ],
};

export const IDEATION_DASHBOARD: DashboardConfig = {
    id: "dashboard-ideation",
    title: "Ideation Agent",
    description: "Metrics for the Ideation Agent — brainstorming and idea exploration",
    agentType: "ideation",
    metrics: [
        { key: "questions_generated", label: "Questions Generated", type: "count" },
        { key: "rag_queries", label: "RAG Queries Made", type: "count" },
        { key: "scope_definitions", label: "Scope Definitions Completed", type: "count" },
        { key: "avg_session_length", label: "Average Session Length", type: "average", unit: "ms" },
    ],
};

export const PLANNING_DASHBOARD: DashboardConfig = {
    id: "dashboard-planning",
    title: "Planning Agent",
    description: "Metrics for the Planning Agent — plan creation and revision",
    agentType: "planning",
    metrics: [
        { key: "plans_created", label: "Plans Created", type: "count" },
        { key: "revisions_per_plan", label: "Revisions Per Plan", type: "average" },
        { key: "dependency_depth", label: "Dependency Depth", type: "average" },
        { key: "avg_planning_time", label: "Average Planning Time", type: "average", unit: "ms" },
    ],
};

export const EXECUTION_DASHBOARD: DashboardConfig = {
    id: "dashboard-execution",
    title: "Execution Agent",
    description: "Metrics for the Execution Agent — task execution and tool calls",
    agentType: "execution",
    metrics: [
        { key: "tasks_executed", label: "Tasks Executed", type: "count" },
        { key: "tool_calls", label: "Tool Calls Made", type: "count" },
        { key: "error_recovery", label: "Error Recovery Events", type: "count" },
        { key: "avg_execution_time", label: "Average Execution Time", type: "average", unit: "ms" },
    ],
};

export const REVIEWER_DASHBOARD: DashboardConfig = {
    id: "dashboard-reviewer",
    title: "Reviewer Agent",
    description: "Metrics for the Reviewer Agent — quality reviews, feedback, HITL, and distillation",
    agentType: "reviewer",
    metrics: [
        { key: "reviews_completed", label: "Reviews Completed", type: "count" },
        { key: "feedback_loops", label: "Feedback Loops Per Review", type: "average" },
        { key: "hitl_triggers", label: "HITL Triggers", type: "count" },
        { key: "quality_score", label: "Quality Score Distribution", type: "distribution" },
        // Level 9 — HITL Metrics
        { key: "hitl_reasons_distribution", label: "HITL Reasons Distribution", type: "distribution" },
        { key: "avg_hitl_resolution_time", label: "Average HITL Resolution Time", type: "average", unit: "ms" },
        // Level 10 — Reviewer Loop Metrics
        { key: "mandatory_gate_pass_rate", label: "Mandatory Gate Pass Rate", type: "rate", unit: "%" },
        { key: "mid_execution_checkpoints", label: "Mid-Execution Checkpoints", type: "count" },
        { key: "avg_quality_score", label: "Average Quality Score", type: "average" },
        { key: "approval_rate", label: "Approval Rate", type: "rate", unit: "%" },
        { key: "revision_rate", label: "Revision Rate", type: "rate", unit: "%" },
        { key: "hitl_rate", label: "HITL Trigger Rate", type: "rate", unit: "%" },
        { key: "avg_revisions_per_task", label: "Average Revisions Per Task", type: "average" },
        { key: "score_improvement_per_round", label: "Score Improvement Per Round", type: "average" },
        { key: "drift_detections", label: "Drift Detections", type: "count" },
        { key: "contradiction_detections", label: "Contradiction Detections", type: "count" },
        { key: "distillation_count", label: "Knowledge Distillation Count", type: "count" },
    ],
};

export const SYSTEM_OVERVIEW_DASHBOARD: DashboardConfig = {
    id: "dashboard-system-overview",
    title: "System Overview",
    description: "Global metrics across all agents — total traces, costs, latency, errors, heartbeat, HITL",
    agentType: null,
    metrics: [
        { key: "total_traces", label: "Total Traces", type: "count" },
        { key: "active_agents", label: "Active Agents", type: "count" },
        { key: "total_cost", label: "Total Cost", type: "sum", unit: "USD" },
        { key: "total_tokens", label: "Total Tokens", type: "sum", unit: "tokens" },
        { key: "error_rate", label: "Error Rate", type: "rate", unit: "%" },
        { key: "latency_p50", label: "Latency p50", type: "p50", unit: "ms" },
        { key: "latency_p95", label: "Latency p95", type: "p95", unit: "ms" },
        { key: "latency_p99", label: "Latency p99", type: "p99", unit: "ms" },
        { key: "voice_interactions", label: "Voice Interactions", type: "count" },
        { key: "stt_error_rate", label: "STT Error Rate", type: "rate", unit: "%" },
        { key: "tts_error_rate", label: "TTS Error Rate", type: "rate", unit: "%" },
        // Level 9 — Heartbeat & HITL Metrics
        { key: "heartbeat_fire_count", label: "Heartbeat Fire Count", type: "count" },
        { key: "tasks_auto_executed", label: "Tasks Auto-Executed", type: "count" },
        { key: "avg_idle_time", label: "Average Idle Time", type: "average", unit: "ms" },
        { key: "hitl_trigger_count", label: "HITL Trigger Count", type: "count" },
        { key: "avg_hitl_pause_duration", label: "Average HITL Pause Duration", type: "average", unit: "ms" },
        // Level 10 — Reviewer Loop Metrics
        { key: "overall_quality_metrics", label: "Overall Quality Score", type: "average" },
        { key: "mandatory_gate_coverage", label: "Mandatory Gate Coverage", type: "rate", unit: "%" },
        { key: "checkpoint_frequency", label: "Checkpoint Frequency", type: "count" },
        { key: "revision_bottlenecks", label: "Revision Bottlenecks", type: "count" },
        { key: "knowledge_base_growth_rate", label: "Knowledge Base Growth Rate", type: "rate" },
    ],
};

/**
 * All dashboard configurations.
 */
export const ALL_DASHBOARDS: DashboardConfig[] = [
    CONVERSATION_DASHBOARD,
    IDEATION_DASHBOARD,
    PLANNING_DASHBOARD,
    EXECUTION_DASHBOARD,
    REVIEWER_DASHBOARD,
    SYSTEM_OVERVIEW_DASHBOARD,
];

/**
 * Get a dashboard config by agent type.
 */
export function getDashboardForAgent(agentType: AgentType): DashboardConfig | undefined {
    return ALL_DASHBOARDS.find((d) => d.agentType === agentType);
}

/**
 * Setup dashboards in LangSmith.
 *
 * Note: LangSmith's dashboard creation is primarily done through
 * the web UI. This function logs the dashboard definitions and
 * can be extended to use the LangSmith API when programmatic
 * dashboard creation becomes available.
 */
export async function setupDashboards(): Promise<{
    created: string[];
    errors: string[];
}> {
    const created: string[] = [];
    const errors: string[] = [];

    for (const dashboard of ALL_DASHBOARDS) {
        try {
            // Log dashboard definition for manual setup reference
            console.log(`📊 Dashboard defined: ${dashboard.title} (${dashboard.metrics.length} metrics)`);
            created.push(dashboard.id);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`${dashboard.id}: ${msg}`);
        }
    }

    return { created, errors };
}
