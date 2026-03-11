/**
 * Level 6 — MCP Integration Types
 *
 * Central type definitions for the MCP (Model Context Protocol) module.
 * MCP servers are external service connections — registered centrally,
 * attached dynamically, and inherited by sub-agents.
 */

import type { AgentType } from "../skills/types.js";

// Re-export for convenience
export type { AgentType } from "../skills/types.js";

// ── Transport ──────────────────────────────────────────────

/** Supported MCP transport protocols */
export type MCPTransport = "sse" | "stdio";

// ── Server Configuration ───────────────────────────────────

/**
 * Static configuration for an MCP server.
 * Loaded from config file or registered at runtime.
 *
 * SECURITY: `authConfig` references .env variable NAMES — never values.
 */
export interface MCPServerConfig {
    /** Unique identifier, e.g. "github-mcp", "slack-mcp" */
    id: string;

    /** Human-readable display name */
    name: string;

    /** Server endpoint URL (SSE endpoint or stdio command) */
    url: string;

    /** Transport protocol */
    transport: MCPTransport;

    /** Which agent types can use this server (empty = all) */
    agentTypes: AgentType[] | "all";

    /** Description of what this server provides */
    description: string;

    /**
     * References to .env variable names for required credentials.
     * Keys are logical names (e.g. "apiKey"), values are env var names (e.g. "GITHUB_TOKEN").
     * NEVER stores actual credential values.
     */
    authConfig: Record<string, string>;

    /** Tool names flagged as destructive (writes, deletes, mutations) */
    destructiveTools: string[];
}

// ── Tool Definitions ───────────────────────────────────────

/**
 * A tool discovered from an MCP server via `tools/list`.
 */
export interface MCPToolDefinition {
    /** Tool name as provided by the server */
    name: string;

    /** Human-readable description */
    description: string;

    /** JSON Schema for the tool's input parameters */
    inputSchema: Record<string, unknown>;

    /** Whether this tool performs destructive actions */
    destructive: boolean;
}

// ── Tool Calling ───────────────────────────────────────────

/** Input for an MCP `tools/call` invocation */
export interface MCPToolCallInput {
    /** Server ID to route the call to */
    serverId: string;

    /** Name of the tool to call */
    toolName: string;

    /** Input parameters matching the tool's inputSchema */
    input: Record<string, unknown>;
}

/** Result of an MCP `tools/call` invocation */
export interface MCPToolCallResult {
    /** Server ID that handled the call */
    serverId: string;

    /** Server display name */
    serverName: string;

    /** Tool that was called */
    toolName: string;

    /** Input that was sent (for tracing) */
    input: Record<string, unknown>;

    /** Output returned by the tool */
    output: unknown;

    /** Whether the call succeeded */
    success: boolean;

    /** Error message if the call failed */
    error?: string;

    /** Call latency in milliseconds */
    latencyMs: number;

    /** ISO timestamp of when the call was made */
    timestamp: string;
}

// ── Connection State ───────────────────────────────────────

/** Connection lifecycle states */
export type MCPConnectionState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "error";

/** Runtime state of a connected MCP server */
export interface MCPAttachedServer {
    /** The server's static config */
    config: MCPServerConfig;

    /** Tools discovered via `tools/list` */
    discoveredTools: MCPToolDefinition[];

    /** Current connection state */
    connectionState: MCPConnectionState;

    /** Timestamp of last successful connection */
    connectedAt?: string;

    /** Number of reconnection attempts since last successful connection */
    reconnectAttempts: number;
}

// ── Server Attachment (per agent) ──────────────────────────

/**
 * Tracks MCP servers attached to a specific agent.
 * Supports sub-agent inheritance (Level 8 prep).
 *
 * - `parentServers`: inherited from parent agent (read-only for sub-agents)
 * - `ownServers`: directly attached to this agent
 */
export interface MCPServerAttachment {
    /** Agent identifier */
    agentId: string;

    /** Servers inherited from parent agent (read-only) */
    parentServers: MCPAttachedServer[];

    /** Servers directly attached to this agent */
    ownServers: MCPAttachedServer[];
}

// ── Confirmation Request ───────────────────────────────────

/**
 * Confirmation request for destructive MCP tool actions.
 * Routed through Conversation Agent to the user.
 */
export interface MCPConfirmationRequest {
    /** Server performing the action */
    serverId: string;

    /** Tool being called */
    toolName: string;

    /** Input parameters (sanitized for display) */
    sanitizedInput: Record<string, unknown>;

    /** Human-readable description of the action */
    actionDescription: string;

    /** Whether the user approved the action */
    approved?: boolean;
}

// ── Config File Format ─────────────────────────────────────

/** Shape of the mcp-servers.json config file */
export interface MCPConfigFile {
    servers: MCPServerConfig[];
}

// ── Validation Helpers ─────────────────────────────────────

/**
 * Check if a value is a valid MCPTransport.
 */
export function isValidTransport(value: unknown): value is MCPTransport {
    return value === "sse" || value === "stdio";
}

/**
 * Check if a value looks like a valid MCPServerConfig.
 * Does NOT validate credential values — only structure.
 */
export function isValidServerConfig(value: unknown): value is MCPServerConfig {
    if (!value || typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    return (
        typeof obj.id === "string" &&
        obj.id.length > 0 &&
        typeof obj.name === "string" &&
        obj.name.length > 0 &&
        typeof obj.url === "string" &&
        obj.url.length > 0 &&
        isValidTransport(obj.transport) &&
        (Array.isArray(obj.agentTypes) || obj.agentTypes === "all") &&
        typeof obj.description === "string" &&
        typeof obj.authConfig === "object" &&
        obj.authConfig !== null &&
        Array.isArray(obj.destructiveTools)
    );
}
