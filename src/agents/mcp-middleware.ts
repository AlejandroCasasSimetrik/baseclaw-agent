/**
 * Level 8 — MCP Middleware
 *
 * Wraps agent functions with automatic MCP tool discovery and execution.
 *
 * Before LLM call:
 *   1. Queries MCPServerRegistry for servers attached to this agent
 *   2. Discovers available tools
 *   3. Converts to OpenAI-format tool definitions
 *   4. Injects tool descriptions into agent prompt
 *
 * After LLM response:
 *   5. If LLM requested tool calls, routes them via routeToolCall()
 *   6. Captures results in Working Memory
 *
 * Usage:
 *   Agents that need MCP tools should add MCP context to their prompts.
 *   The execution agent is the primary consumer.
 */

import { SystemMessage } from "@langchain/core/messages";
import { MCPServerRegistry } from "../mcp/registry.js";
import type { MCPServerConfig } from "../mcp/types.js";

// Shared registry — set from index.ts/server.ts
let _mcpRegistry: MCPServerRegistry | null = null;

/** Set the MCP registry from initialization code */
export function setMCPRegistry(registry: MCPServerRegistry): void {
    _mcpRegistry = registry;
}

/** Get the current MCP registry */
export function getMCPRegistry(): MCPServerRegistry | null {
    return _mcpRegistry;
}

/**
 * Build a system message describing available MCP tools for this agent.
 *
 * Returns null if no servers are attached or registry is unavailable.
 */
export function buildMCPToolPrompt(
    agentType: string
): SystemMessage | null {
    if (!_mcpRegistry) return null;

    try {
        const agentTypeForRegistry = agentType as any;
        const servers = _mcpRegistry.getServersForAgent(agentTypeForRegistry);

        if (servers.length === 0) return null;

        const toolDescriptions = servers
            .map((server: MCPServerConfig) => {
                const destructiveList = server.destructiveTools.length > 0
                    ? ` (destructive: ${server.destructiveTools.join(", ")})`
                    : "";
                return `- **${server.name}** (${server.id}): ${server.description}${destructiveList}`;
            })
            .join("\n");

        return new SystemMessage(
            `# Available MCP Servers\n\n` +
            `The following external MCP servers are connected and available. ` +
            `You may reference these services in your response if they would help accomplish the task.\n\n` +
            toolDescriptions
        );
    } catch {
        return null;
    }
}
