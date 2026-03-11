/**
 * Level 6 — MCP Tool Discovery
 *
 * Discovers tools from MCP servers via the `tools/list` protocol method.
 * Parses tool schemas, validates definitions, and formats tools for
 * injection into agent context alongside skill prompt fragments.
 */

import { traceable } from "langsmith/traceable";
import type { MCPClient, MCPConnectionHandle } from "./client.js";
import type { MCPToolDefinition } from "./types.js";

/**
 * Discover all tools available on a connected MCP server.
 * Wraps the client's listTools with additional validation.
 *
 * Traced as a LangSmith span.
 */
export const discoverTools = traceable(
    async (
        client: MCPClient,
        handle: MCPConnectionHandle
    ): Promise<MCPToolDefinition[]> => {
        const tools = await client.listTools(handle);

        // Validate each discovered tool
        return tools.filter((tool) => validateToolDefinition(tool));
    },
    { name: "mcp.discoverTools" }
);

/**
 * Validate that a tool definition has all required fields.
 * Returns true if valid, false if missing required fields.
 */
export function validateToolDefinition(tool: MCPToolDefinition): boolean {
    if (!tool.name || typeof tool.name !== "string") {
        return false;
    }
    if (typeof tool.description !== "string") {
        return false;
    }
    if (typeof tool.inputSchema !== "object" || tool.inputSchema === null) {
        return false;
    }
    return true;
}

/**
 * Format discovered MCP tools for injection into an agent's context.
 * Produces a text block similar to skill systemPromptFragments
 * so the LLM can decide when to use MCP tools.
 */
export function formatToolsForContext(
    serverId: string,
    serverName: string,
    tools: MCPToolDefinition[]
): string {
    if (tools.length === 0) {
        return "";
    }

    const toolDescriptions = tools
        .map((tool) => {
            const params = formatInputSchema(tool.inputSchema);
            const destructiveWarning = tool.destructive
                ? " ⚠️ DESTRUCTIVE — requires user confirmation"
                : "";
            return `  - ${tool.name}: ${tool.description}${destructiveWarning}\n    Parameters: ${params}`;
        })
        .join("\n");

    return `[MCP Server: ${serverName} (${serverId})]\nAvailable tools:\n${toolDescriptions}`;
}

/**
 * Format a JSON Schema input into a human-readable parameter description.
 */
export function formatInputSchema(
    schema: Record<string, unknown>
): string {
    if (!schema || Object.keys(schema).length === 0) {
        return "none";
    }

    const properties = schema.properties as
        | Record<string, Record<string, unknown>>
        | undefined;
    if (!properties) {
        return JSON.stringify(schema);
    }

    const required = (schema.required as string[]) ?? [];

    const params = Object.entries(properties).map(([name, propSchema]) => {
        const type = String(propSchema.type ?? "any");
        const desc = propSchema.description
            ? ` — ${propSchema.description}`
            : "";
        const req = required.includes(name) ? " (required)" : " (optional)";
        return `${name}: ${type}${req}${desc}`;
    });

    return `{ ${params.join(", ")} }`;
}

/**
 * Merge MCP tool context strings with skill prompt fragments
 * to produce the full context for an agent.
 */
export function mergeToolContextWithSkills(
    skillFragments: string[],
    mcpToolContexts: string[]
): string {
    const parts: string[] = [];

    if (skillFragments.length > 0) {
        parts.push("## Loaded Skills\n" + skillFragments.join("\n\n"));
    }

    if (mcpToolContexts.length > 0) {
        parts.push(
            "## Available MCP Tools\n" + mcpToolContexts.join("\n\n")
        );
    }

    return parts.join("\n\n");
}
