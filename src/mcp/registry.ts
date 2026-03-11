/**
 * Level 6 — MCP Server Registry
 *
 * Central source of truth for all available MCP servers.
 * Mirrors the SkillRegistry pattern from Level 2:
 *   - registerServer / unregisterServer / getServersForAgent / getAvailableServers
 *   - Credential validation against .env (by variable name, never by value)
 *   - Sub-agent inheritance preparation (getInheritedServers)
 */

import type { MCPServerConfig } from "./types.js";
import type { AgentType } from "../skills/types.js";
import { inspectorBus } from "../inspector/event-bus.js";

export class MCPServerRegistry {
    private servers: Map<string, MCPServerConfig> = new Map();

    /**
     * Register a new MCP server.
     * Throws if a server with the same ID already exists.
     * Validates that required .env credentials are present.
     */
    registerServer(config: MCPServerConfig): void {
        if (this.servers.has(config.id)) {
            throw new Error(
                `MCP server "${config.id}" is already registered. Use unregisterServer() first to replace it.`
            );
        }

        // Validate credentials exist in environment
        if (!this.validateCredentials(config)) {
            throw new Error(
                `MCP server "${config.id}" requires credentials that are not set in .env: ` +
                this.getMissingCredentials(config).join(", ")
            );
        }

        this.servers.set(config.id, config);

        // Notify inspector
        inspectorBus.emitMCPEvent("mcp:registered", {
            serverId: config.id,
            serverName: config.name,
            transport: config.transport,
            agentTypes: config.agentTypes,
        });
    }

    /**
     * Remove a server from the registry by ID.
     * Returns true if found and removed, false otherwise.
     */
    unregisterServer(serverId: string): boolean {
        const removed = this.servers.delete(serverId);
        if (removed) {
            inspectorBus.emitMCPEvent("mcp:unregistered", { serverId });
        }
        return removed;
    }

    /**
     * Get a single server by ID.
     */
    getServer(serverId: string): MCPServerConfig | undefined {
        return this.servers.get(serverId);
    }

    /**
     * Get all registered servers.
     */
    getAvailableServers(): MCPServerConfig[] {
        return Array.from(this.servers.values());
    }

    /**
     * Get all servers available to a specific agent type.
     * A server is available if its agentTypes is "all" or includes the given type.
     */
    getServersForAgent(agentType: AgentType): MCPServerConfig[] {
        return this.getAvailableServers().filter((server) => {
            if (server.agentTypes === "all") return true;
            return server.agentTypes.includes(agentType);
        });
    }

    /**
     * Validate that all required .env credentials exist for a server config.
     * Checks by variable name — never reads or stores the actual values.
     * Returns true if all required credentials are present (or none required).
     */
    validateCredentials(config: MCPServerConfig): boolean {
        return this.getMissingCredentials(config).length === 0;
    }

    /**
     * Get list of missing .env variable names for a server config.
     */
    getMissingCredentials(config: MCPServerConfig): string[] {
        const missing: string[] = [];
        for (const [, envVarName] of Object.entries(config.authConfig)) {
            if (!process.env[envVarName]) {
                missing.push(envVarName);
            }
        }
        return missing;
    }

    /**
     * Get the number of registered servers.
     */
    get size(): number {
        return this.servers.size;
    }

    /**
     * Clear all servers from the registry.
     */
    clear(): void {
        this.servers.clear();
    }

    /**
     * Stub for Level 8 — Sub-agent MCP server inheritance.
     *
     * Returns servers that the parent agent type has access to
     * AND the child agent type can also use.
     */
    getInheritedServers(
        childAgentType: AgentType,
        parentAgentType: AgentType
    ): MCPServerConfig[] {
        const parentServers = this.getServersForAgent(parentAgentType);
        return parentServers.filter((server) => {
            if (server.agentTypes === "all") return true;
            return server.agentTypes.includes(childAgentType);
        });
    }
}
