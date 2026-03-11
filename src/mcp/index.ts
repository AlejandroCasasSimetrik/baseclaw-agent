/**
 * MCP Module — Public API
 *
 * Central export point for the MCP integration system.
 * Import from here rather than individual files.
 */

// ── Types ────────────────────────────────────────────────────
export type {
    MCPTransport,
    MCPServerConfig,
    MCPToolDefinition,
    MCPToolCallInput,
    MCPToolCallResult,
    MCPConnectionState,
    MCPAttachedServer,
    MCPServerAttachment,
    MCPConfirmationRequest,
    MCPConfigFile,
} from "./types.js";

export { isValidTransport, isValidServerConfig } from "./types.js";

// ── Server Registry ──────────────────────────────────────────
export { MCPServerRegistry } from "./registry.js";

// ── Client ───────────────────────────────────────────────────
export { MCPClient } from "./client.js";
export type { MCPConnectionHandle, BackoffConfig } from "./client.js";

// ── Tool Discovery ───────────────────────────────────────────
export {
    discoverTools,
    validateToolDefinition,
    formatToolsForContext,
    formatInputSchema,
    mergeToolContextWithSkills,
} from "./tool-discovery.js";

// ── Tool Calling ─────────────────────────────────────────────
export {
    routeToolCall,
    isDestructiveAction,
    createConfirmationRequest,
    captureToolResult,
    buildMcpUsageLog,
} from "./tool-calling.js";

// ── Attachment Manager ───────────────────────────────────────
export { MCPAttachmentManager } from "./attachment.js";

// ── Config Loader ────────────────────────────────────────────
export { loadMCPConfig, registerServersFromConfig } from "./config.js";
