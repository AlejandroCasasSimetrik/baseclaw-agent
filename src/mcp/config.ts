/**
 * Level 6 — MCP Config Loader
 *
 * Loads MCP server configurations from a JSON config file.
 * Config file path defaults to ./mcp-servers.json at project root.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isValidServerConfig } from "./types.js";
import type { MCPServerConfig, MCPConfigFile } from "./types.js";
import { MCPServerRegistry } from "./registry.js";

/** Default config file path (relative to process.cwd()) */
const DEFAULT_CONFIG_PATH = "mcp-servers.json";

/**
 * Load MCP server configurations from a JSON file.
 * Returns an empty array if the file doesn't exist.
 * Throws on malformed JSON or invalid server configs.
 *
 * @param filePath - Absolute or relative path to the config file
 */
export function loadMCPConfig(
    filePath?: string
): MCPServerConfig[] {
    const resolvedPath = path.resolve(
        process.cwd(),
        filePath ?? DEFAULT_CONFIG_PATH
    );

    if (!fs.existsSync(resolvedPath)) {
        return [];
    }

    const raw = fs.readFileSync(resolvedPath, "utf-8");

    let parsed: MCPConfigFile;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(
            `Failed to parse MCP config file at ${resolvedPath}: ${error instanceof Error ? error.message : String(error)
            }`
        );
    }

    if (!parsed || !Array.isArray(parsed.servers)) {
        throw new Error(
            `Invalid MCP config file format: expected { "servers": [...] }`
        );
    }

    // Validate each server config
    const validConfigs: MCPServerConfig[] = [];
    const errors: string[] = [];

    for (let i = 0; i < parsed.servers.length; i++) {
        const serverConfig = parsed.servers[i];
        if (isValidServerConfig(serverConfig)) {
            validConfigs.push(serverConfig);
        } else {
            errors.push(
                `servers[${i}] is invalid: missing or malformed required fields`
            );
        }
    }

    if (errors.length > 0) {
        throw new Error(
            `MCP config validation errors:\n${errors.join("\n")}`
        );
    }

    return validConfigs;
}

/**
 * Register all servers from a config array into the registry.
 * Skips servers with missing credentials (logs warning instead of throwing).
 *
 * @returns Array of server IDs that were successfully registered
 */
export function registerServersFromConfig(
    registry: MCPServerRegistry,
    configs: MCPServerConfig[]
): string[] {
    const registered: string[] = [];

    for (const config of configs) {
        try {
            registry.registerServer(config);
            registered.push(config.id);
        } catch (error) {
            // Log but don't throw — allow partial registration
            console.warn(
                `⚠️  MCP server "${config.id}" skipped: ${error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    return registered;
}
