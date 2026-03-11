/**
 * Level 8 — Sub-agent Spawning Types
 *
 * Central type definitions for sub-agent lifecycle, coordination, and safety.
 * Sub-agents are first-class execution units that inherit skills, MCP servers,
 * and memory access from their parent agent.
 */

import type { AgentType } from "../skills/types.js";
import type { WorkingMemoryState } from "../memory/types.js";
import type { SkillDefinition } from "../skills/types.js";

// Re-export for convenience
export type { AgentType } from "../skills/types.js";

// ── Spawnable Agent Types ──────────────────────────────────

/**
 * Only 4 main agents can spawn sub-agents.
 * Conversation Agent is explicitly excluded.
 */
export type SpawnableAgentType = "ideation" | "planning" | "execution" | "reviewer";

/** Check if an agent type can spawn sub-agents */
export function isSpawnableAgentType(type: string): type is SpawnableAgentType {
    return ["ideation", "planning", "execution", "reviewer"].includes(type);
}

// ── Sub-agent Lifecycle States ─────────────────────────────

export type SubAgentStatus =
    | "pending"      // Queued, waiting for concurrency slot
    | "running"      // Actively executing
    | "completed"    // Finished successfully
    | "cancelled"    // Cancelled by parent or cascade
    | "error"        // Failed with error
    | "timed_out";   // Exceeded execution timeout

// ── Sub-agent Configuration ───────────────────────────────

/**
 * Configuration for spawning a sub-agent.
 * Passed to `spawnSubAgent()`.
 */
export interface SubAgentConfig {
    /** The task for the sub-agent to execute */
    task: string;

    /** Parent agent's unique ID */
    parentAgentId: string;

    /** Parent agent's type (sub-agent inherits this type) */
    parentAgentType: SpawnableAgentType;

    /** Tenant ID — inherited from parent */
    tenantId: string;

    /** Parent's currently loaded skill IDs (snapshot at spawn time) */
    parentSkillIds: string[];

    /** Parent's LangSmith trace ID for nesting */
    parentTraceId: string;

    /** Maximum iterations for the sub-agent (inherited from system config) */
    maxIterations?: number;

    /** Execution timeout in milliseconds (default: 600_000 = 10 minutes) */
    timeoutMs?: number;

    /** Whether this is itself a sub-agent (for depth check) */
    isSubAgent?: boolean;

    /** Parent's attached MCP server IDs */
    parentMCPServerIds?: string[];
}

// ── Sub-agent State ───────────────────────────────────────

/**
 * Runtime state of a sub-agent instance.
 * Maintained by the SubAgentRegistry.
 */
export interface SubAgentState {
    /** Unique sub-agent ID: `{parentAgentType}-sub-{uuid}` */
    id: string;

    /** The parent agent's unique ID */
    parentAgentId: string;

    /** Agent type (same as parent) */
    agentType: SpawnableAgentType;

    /** Current lifecycle status */
    status: SubAgentStatus;

    /** The task being executed */
    task: string;

    /** Tenant ID (inherited from parent) */
    tenantId: string;

    /** Inherited skill IDs (snapshot from parent at spawn time) */
    inheritedSkillIds: string[];

    /** Inherited MCP server IDs (read-only from parent) */
    inheritedMCPServerIds: string[];

    /** Own MCP server IDs (attached by the sub-agent itself) */
    ownMCPServerIds: string[];

    /** LangSmith trace ID for this sub-agent's execution */
    traceId: string;

    /** Parent's LangSmith trace ID */
    parentTraceId: string;

    /** Sub-agent's isolated Working Memory */
    workingMemory: WorkingMemoryState | null;

    /** Spawn timestamp */
    spawnedAt: string;

    /** Completion timestamp */
    completedAt?: string;

    /** Result (populated after completion) */
    result?: SubAgentResult;

    /** Error (populated on failure) */
    error?: string;
}

// ── Sub-agent Result ──────────────────────────────────────

/**
 * Structured result returned by a sub-agent after execution.
 */
export interface SubAgentResult {
    /** The sub-agent's output text/content */
    output: string;

    /** Execution metadata */
    metadata: SubAgentResultMetadata;

    /** Brief summary of what the sub-agent did */
    executionSummary: string;
}

export interface SubAgentResultMetadata {
    /** Sub-agent's unique ID */
    subAgentId: string;

    /** Agent type */
    agentType: SpawnableAgentType;

    /** Total execution duration in milliseconds */
    durationMs: number;

    /** Number of iterations the sub-agent used */
    iterationsUsed: number;

    /** Skills that were loaded during execution */
    skillsUsed: string[];

    /** MCP tools that were called during execution */
    mcpToolsCalled: string[];

    /** LangSmith trace ID */
    traceId: string;

    /** Episode ID from Episodic Memory */
    episodeId?: string;
}

// ── LangSmith Trace Metadata ──────────────────────────────

/**
 * Metadata attached to sub-agent traces in LangSmith.
 */
export interface SubAgentTraceMetadata {
    is_sub_agent: true;
    parent_agent_id: string;
    parent_trace_id: string;
    sub_agent_id: string;
    inherited_skills: string[];
    inherited_mcp_servers: string[];
}

/**
 * Build trace metadata for a sub-agent.
 */
export function buildSubAgentTraceMetadata(
    state: SubAgentState
): SubAgentTraceMetadata {
    return {
        is_sub_agent: true,
        parent_agent_id: state.parentAgentId,
        parent_trace_id: state.parentTraceId,
        sub_agent_id: state.id,
        inherited_skills: state.inheritedSkillIds,
        inherited_mcp_servers: state.inheritedMCPServerIds,
    };
}

// ── Constants ─────────────────────────────────────────────

/** Maximum sub-agent spawning depth. Sub-agents cannot spawn sub-sub-agents. */
export const MAX_SPAWN_DEPTH = 1;

/** Default maximum concurrent sub-agents per parent */
export const DEFAULT_CONCURRENCY_LIMIT = 5;

/** Default sub-agent execution timeout (10 minutes) */
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 600,000 ms

/** Default max iterations for sub-agents (same as main agents) */
export const DEFAULT_MAX_ITERATIONS = 25;
