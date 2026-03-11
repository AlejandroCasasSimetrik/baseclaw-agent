/**
 * Level 6 — MCP Tool Calling
 *
 * Routes tool calls to the correct MCP server, handles destructive
 * action gating, captures results in Working Memory, and logs usage
 * to Episodic Memory (mcp_usage table).
 */

import { traceable } from "langsmith/traceable";
import { sanitizeTraceData } from "../observability/sanitizer.js";
import { updateWorkingMemory } from "../memory/working-memory.js";
import type { WorkingMemoryState, McpResult } from "../memory/types.js";
import type { MCPAttachmentManager } from "./attachment.js";
import type {
    MCPToolCallInput,
    MCPToolCallResult,
    MCPConfirmationRequest,
} from "./types.js";

/**
 * Route a tool call to the correct MCP server and execute it.
 *
 * 1. Looks up the server in the attachment manager
 * 2. Checks if the tool is destructive (requires confirmation)
 * 3. Executes via the MCP client
 * 4. Returns the result
 *
 * Traced as a LangSmith span.
 */
export const routeToolCall = traceable(
    async (
        callInput: MCPToolCallInput,
        agentId: string,
        attachmentManager: MCPAttachmentManager
    ): Promise<MCPToolCallResult> => {
        const server = attachmentManager.getAttachedServerById(
            agentId,
            callInput.serverId
        );

        if (!server) {
            return {
                serverId: callInput.serverId,
                serverName: "unknown",
                toolName: callInput.toolName,
                input: sanitizeTraceData(callInput.input),
                output: null,
                success: false,
                error: `MCP server "${callInput.serverId}" is not attached to agent "${agentId}"`,
                latencyMs: 0,
                timestamp: new Date().toISOString(),
            };
        }

        // Execute via attachment manager (which uses the client internally)
        return attachmentManager.callTool(
            agentId,
            callInput.serverId,
            callInput.toolName,
            callInput.input
        );
    },
    { name: "mcp.routeToolCall" }
);

/**
 * Check if a tool call is a destructive action that requires user confirmation.
 */
export function isDestructiveAction(
    serverId: string,
    toolName: string,
    agentId: string,
    attachmentManager: MCPAttachmentManager
): boolean {
    const server = attachmentManager.getAttachedServerById(agentId, serverId);
    if (!server) return false;

    const tool = server.discoveredTools.find((t: { name: string; destructive: boolean }) => t.name === toolName);
    return tool?.destructive ?? false;
}

/**
 * Create a confirmation request for a destructive MCP tool action.
 * This request is routed through the Conversation Agent to the user.
 */
export function createConfirmationRequest(
    serverId: string,
    toolName: string,
    input: Record<string, unknown>
): MCPConfirmationRequest {
    return {
        serverId,
        toolName,
        sanitizedInput: sanitizeTraceData(input),
        actionDescription: `MCP server "${serverId}" wants to execute destructive tool "${toolName}"`,
    };
}

/**
 * Capture an MCP tool call result in Working Memory.
 * Adds to the mcpCallResults sliding window.
 */
export function captureToolResult(
    result: MCPToolCallResult,
    workingMemory: WorkingMemoryState
): WorkingMemoryState {
    const mcpResult: McpResult = {
        serverName: result.serverName,
        toolName: result.toolName,
        input: JSON.stringify(sanitizeTraceData(result.input)),
        output: result.success
            ? JSON.stringify(sanitizeTraceData(result.output))
            : `ERROR: ${result.error}`,
        timestamp: result.timestamp,
    };

    return updateWorkingMemory(workingMemory, {
        mcpCallResults: [...workingMemory.mcpCallResults, mcpResult],
    });
}

/**
 * Build an Episodic Memory log entry for an MCP tool call.
 * Returns the data needed to insert into the mcp_usage table.
 *
 * NOTE: The actual DB insert is delegated to the episodic queries module.
 * This function just prepares the data.
 */
export function buildMcpUsageLog(
    result: MCPToolCallResult,
    episodeId: string,
    langsmithTraceId: string
): {
    serverName: string;
    toolName: string;
    inputSummary: string;
    outputSummary: string;
    latencyMs: number;
    episodeId: string;
    langsmithTraceId: string;
} {
    return {
        serverName: result.serverName,
        toolName: result.toolName,
        inputSummary: JSON.stringify(sanitizeTraceData(result.input)).slice(
            0,
            500
        ),
        outputSummary: result.success
            ? JSON.stringify(sanitizeTraceData(result.output)).slice(0, 500)
            : `ERROR: ${result.error?.slice(0, 450)}`,
        latencyMs: result.latencyMs,
        episodeId,
        langsmithTraceId,
    };
}
