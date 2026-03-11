/**
 * Level 6 — MCP Server Attachment Manager
 *
 * Manages dynamic attachment and detachment of MCP servers per agent.
 * Supports sub-agent inheritance: parentServers (inherited, read-only)
 * + ownServers (attached directly).
 *
 * All operations traced via LangSmith.
 */

import { traceable } from "langsmith/traceable";
import { MCPClient } from "./client.js";
import type { MCPConnectionHandle } from "./client.js";
import { MCPServerRegistry } from "./registry.js";
import { discoverTools } from "./tool-discovery.js";
import type {
    MCPAttachedServer,
    MCPServerAttachment,
    MCPToolDefinition,
    MCPToolCallResult,
} from "./types.js";

export class MCPAttachmentManager {
    /** Per-agent attachment tracking */
    private attachments: Map<string, MCPServerAttachment> = new Map();

    /** Active connection handles by "agentId:serverId" */
    private handles: Map<string, MCPConnectionHandle> = new Map();

    /** Shared MCP client instance */
    private client: MCPClient;

    /** Server registry reference */
    private registry: MCPServerRegistry;

    constructor(registry: MCPServerRegistry, client?: MCPClient) {
        this.registry = registry;
        this.client = client ?? new MCPClient();
    }

    /**
     * Attach an MCP server to an agent.
     * Connects, discovers tools, and makes them available.
     *
     * Traced as a LangSmith span.
     */
    attachServer = traceable(
        async (
            agentId: string,
            serverId: string
        ): Promise<MCPAttachedServer> => {
            const config = this.registry.getServer(serverId);
            if (!config) {
                throw new Error(
                    `MCP server "${serverId}" is not registered in the registry`
                );
            }

            // Check if already attached
            const existing = this.getAttachedServerById(agentId, serverId);
            if (existing) {
                return existing;
            }

            // Connect
            const handle = await this.client.connect(config);
            this.handles.set(`${agentId}:${serverId}`, handle);

            // Discover tools
            const discoveredTools = await discoverTools(this.client, handle);

            const attachedServer: MCPAttachedServer = {
                config,
                discoveredTools,
                connectionState: "connected",
                connectedAt: new Date().toISOString(),
                reconnectAttempts: 0,
            };

            // Add to agent's own servers
            const attachment = this.getOrCreateAttachment(agentId);
            attachment.ownServers.push(attachedServer);

            return attachedServer;
        },
        { name: "mcp.attachServer" }
    );

    /**
     * Detach an MCP server from an agent.
     * Gracefully disconnects and removes tools.
     *
     * Traced as a LangSmith span.
     */
    detachServer = traceable(
        async (agentId: string, serverId: string): Promise<boolean> => {
            const handleKey = `${agentId}:${serverId}`;
            const handle = this.handles.get(handleKey);

            if (handle) {
                await this.client.disconnect(handle);
                this.handles.delete(handleKey);
            }

            const attachment = this.attachments.get(agentId);
            if (!attachment) return false;

            const idx = attachment.ownServers.findIndex(
                (s) => s.config.id === serverId
            );
            if (idx === -1) return false;

            attachment.ownServers.splice(idx, 1);
            return true;
        },
        { name: "mcp.detachServer" }
    );

    /**
     * Get all servers currently attached to an agent.
     * Includes both inherited (parent) and own servers.
     */
    getAttachedServers(agentId: string): MCPAttachedServer[] {
        const attachment = this.attachments.get(agentId);
        if (!attachment) return [];
        return [...attachment.parentServers, ...attachment.ownServers];
    }

    /**
     * Get a specific attached server by ID.
     * Checks both parent and own servers.
     */
    getAttachedServerById(
        agentId: string,
        serverId: string
    ): MCPAttachedServer | undefined {
        return this.getAttachedServers(agentId).find(
            (s) => s.config.id === serverId
        );
    }

    /**
     * Get all tools available to an agent from all attached MCP servers.
     */
    getAvailableTools(
        agentId: string
    ): Array<{ serverId: string; tool: MCPToolDefinition }> {
        const servers = this.getAttachedServers(agentId);
        const tools: Array<{ serverId: string; tool: MCPToolDefinition }> = [];

        for (const server of servers) {
            for (const tool of server.discoveredTools) {
                tools.push({ serverId: server.config.id, tool });
            }
        }

        return tools;
    }

    /**
     * Call a tool on an attached MCP server.
     */
    async callTool(
        agentId: string,
        serverId: string,
        toolName: string,
        input: Record<string, unknown>
    ): Promise<MCPToolCallResult> {
        const handleKey = `${agentId}:${serverId}`;
        const handle = this.handles.get(handleKey);

        if (!handle) {
            return {
                serverId,
                serverName: "unknown",
                toolName,
                input,
                output: null,
                success: false,
                error: `No active connection for server "${serverId}" on agent "${agentId}"`,
                latencyMs: 0,
                timestamp: new Date().toISOString(),
            };
        }

        return this.client.callTool(handle, toolName, input);
    }

    /**
     * Inherit servers from a parent agent (Level 8 preparation).
     * Copies the parent's attached servers as read-only parentServers.
     */
    inheritServers(childAgentId: string, parentAgentId: string): void {
        const parentAttachment = this.attachments.get(parentAgentId);
        if (!parentAttachment) return;

        const childAttachment = this.getOrCreateAttachment(childAgentId);

        // Copy all parent servers (both parent's inherited and own) as child's parentServers
        childAttachment.parentServers = [
            ...parentAttachment.parentServers,
            ...parentAttachment.ownServers,
        ];

        // Also share connection handles
        for (const server of childAttachment.parentServers) {
            const parentHandleKey = `${parentAgentId}:${server.config.id}`;
            const handle = this.handles.get(parentHandleKey);
            if (handle) {
                this.handles.set(
                    `${childAgentId}:${server.config.id}`,
                    handle
                );
            }
        }
    }

    /**
     * Get the attachment record for an agent, or create a new one.
     */
    private getOrCreateAttachment(agentId: string): MCPServerAttachment {
        let attachment = this.attachments.get(agentId);
        if (!attachment) {
            attachment = {
                agentId,
                parentServers: [],
                ownServers: [],
            };
            this.attachments.set(agentId, attachment);
        }
        return attachment;
    }

    /**
     * Get the number of agents with attached servers.
     */
    get agentCount(): number {
        return this.attachments.size;
    }

    /**
     * Clear all attachments. Used in tests.
     */
    clear(): void {
        this.attachments.clear();
        this.handles.clear();
    }
}
