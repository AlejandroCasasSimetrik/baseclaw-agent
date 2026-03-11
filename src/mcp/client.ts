/**
 * Level 6 — MCP Client
 *
 * Reusable MCP client that handles:
 *   - Connection management (connect, disconnect, reconnect on failure)
 *   - Transport abstraction (SSE implemented, stdio stubbed)
 *   - Tool listing (tools/list)
 *   - Tool calling (tools/call) with proper I/O handling
 *   - Error handling: connection failures, timeout, invalid responses
 *   - Automatic reconnection with exponential backoff
 *
 * The client is stateless per-call — does NOT cache tool results.
 * All operations traced via LangSmith.
 */

import { traceable } from "langsmith/traceable";
import { sanitizeTraceData } from "../observability/sanitizer.js";
import type {
    MCPServerConfig,
    MCPToolDefinition,
    MCPToolCallResult,
    MCPConnectionState,
} from "./types.js";

// ── Connection Handle ──────────────────────────────────────

/**
 * Represents an active connection to an MCP server.
 * Manages connection state and reconnection logic.
 */
export interface MCPConnectionHandle {
    /** Server config this handle is for */
    config: MCPServerConfig;

    /** Current connection state */
    state: MCPConnectionState;

    /** Number of reconnection attempts since last success */
    reconnectAttempts: number;

    /** Timestamp of last successful connection */
    connectedAt?: string;

    /** Number of in-flight tool calls */
    inFlightCalls: number;
}

// ── Backoff Configuration ──────────────────────────────────

export interface BackoffConfig {
    /** Base delay in milliseconds (default: 1000) */
    baseDelayMs: number;
    /** Maximum delay in milliseconds (default: 30000) */
    maxDelayMs: number;
    /** Maximum number of retry attempts (default: 5) */
    maxRetries: number;
}

const DEFAULT_BACKOFF: BackoffConfig = {
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    maxRetries: 5,
};

/** Default timeout per tool call in milliseconds */
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

// ── MCPClient ──────────────────────────────────────────────

export class MCPClient {
    private backoff: BackoffConfig;
    private callTimeoutMs: number;

    constructor(
        backoff: BackoffConfig = DEFAULT_BACKOFF,
        callTimeoutMs: number = DEFAULT_CALL_TIMEOUT_MS
    ) {
        this.backoff = backoff;
        this.callTimeoutMs = callTimeoutMs;
    }

    /**
     * Connect to an MCP server.
     * For SSE: establishes connection to the server endpoint.
     * For stdio: throws — not yet implemented.
     *
     * Traced as a LangSmith span.
     */
    connect = traceable(
        async (config: MCPServerConfig): Promise<MCPConnectionHandle> => {
            if (config.transport === "stdio") {
                throw new Error(
                    `stdio transport is not yet implemented for MCP server "${config.id}". Use SSE transport.`
                );
            }

            const handle: MCPConnectionHandle = {
                config,
                state: "connecting",
                reconnectAttempts: 0,
                inFlightCalls: 0,
            };

            try {
                // Validate the server is reachable by attempting a connection
                await this.pingServer(config.url);

                handle.state = "connected";
                handle.connectedAt = new Date().toISOString();

                return handle;
            } catch (error) {
                handle.state = "error";
                throw new Error(
                    `Failed to connect to MCP server "${config.id}" at ${config.url}: ${error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        },
        { name: "mcp.connect" }
    );

    /**
     * Disconnect from an MCP server.
     * Waits for in-flight calls to complete before disconnecting.
     *
     * Traced as a LangSmith span.
     */
    disconnect = traceable(
        async (handle: MCPConnectionHandle): Promise<void> => {
            // Wait for in-flight calls to complete (with timeout)
            const maxWait = 10_000;
            const start = Date.now();
            while (
                handle.inFlightCalls > 0 &&
                Date.now() - start < maxWait
            ) {
                await this.sleep(100);
            }

            handle.state = "disconnected";
            handle.reconnectAttempts = 0;
        },
        { name: "mcp.disconnect" }
    );

    /**
     * List all tools available on the connected MCP server.
     * Calls the MCP protocol's `tools/list` method.
     *
     * Traced as a LangSmith span.
     */
    listTools = traceable(
        async (handle: MCPConnectionHandle): Promise<MCPToolDefinition[]> => {
            this.assertConnected(handle);

            try {
                const response = await this.sendRequest(
                    handle.config.url,
                    "tools/list",
                    {}
                );

                if (!response || !Array.isArray(response.tools)) {
                    throw new Error(
                        "Invalid tools/list response: expected { tools: [...] }"
                    );
                }

                // Parse and validate each tool
                const tools: MCPToolDefinition[] = response.tools.map(
                    (tool: Record<string, unknown>) => ({
                        name: String(tool.name ?? ""),
                        description: String(tool.description ?? ""),
                        inputSchema: (tool.inputSchema ??
                            tool.input_schema ??
                            {}) as Record<string, unknown>,
                        destructive:
                            handle.config.destructiveTools.includes(
                                String(tool.name ?? "")
                            ),
                    })
                );

                return tools;
            } catch (error) {
                throw new Error(
                    `Failed to list tools from MCP server "${handle.config.id}": ${error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        },
        { name: "mcp.listTools" }
    );

    /**
     * Call a specific tool on the MCP server.
     * Validates the response before returning.
     *
     * Traced as a LangSmith span.
     */
    callTool = traceable(
        async (
            handle: MCPConnectionHandle,
            toolName: string,
            input: Record<string, unknown>
        ): Promise<MCPToolCallResult> => {
            this.assertConnected(handle);

            const startTime = Date.now();
            handle.inFlightCalls++;

            try {
                const sanitizedInput = sanitizeTraceData(input);

                const response = await this.sendRequestWithTimeout(
                    handle.config.url,
                    "tools/call",
                    { name: toolName, arguments: sanitizedInput },
                    this.callTimeoutMs
                );

                // Validate response structure
                this.validateToolResponse(response);

                const latencyMs = Date.now() - startTime;

                const result: MCPToolCallResult = {
                    serverId: handle.config.id,
                    serverName: handle.config.name,
                    toolName,
                    input: sanitizedInput,
                    output: sanitizeTraceData(response?.content ?? response),
                    success: true,
                    latencyMs,
                    timestamp: new Date().toISOString(),
                };

                return result;
            } catch (error) {
                const latencyMs = Date.now() - startTime;
                return {
                    serverId: handle.config.id,
                    serverName: handle.config.name,
                    toolName,
                    input: sanitizeTraceData(input),
                    output: null,
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                    latencyMs,
                    timestamp: new Date().toISOString(),
                };
            } finally {
                handle.inFlightCalls--;
            }
        },
        { name: "mcp.callTool" }
    );

    /**
     * Attempt to reconnect to a server with exponential backoff.
     *
     * Traced as a LangSmith span.
     */
    reconnect = traceable(
        async (handle: MCPConnectionHandle): Promise<boolean> => {
            for (let attempt = 1; attempt <= this.backoff.maxRetries; attempt++) {
                handle.state = "reconnecting";
                handle.reconnectAttempts = attempt;

                const delay = Math.min(
                    this.backoff.baseDelayMs * Math.pow(2, attempt - 1),
                    this.backoff.maxDelayMs
                );

                await this.sleep(delay);

                try {
                    await this.pingServer(handle.config.url);
                    handle.state = "connected";
                    handle.connectedAt = new Date().toISOString();
                    handle.reconnectAttempts = 0;
                    return true;
                } catch {
                    // Continue to next attempt
                }
            }

            handle.state = "error";
            return false;
        },
        { name: "mcp.reconnect" }
    );

    /**
     * Get the current connection state.
     */
    getConnectionState(handle: MCPConnectionHandle): MCPConnectionState {
        return handle.state;
    }

    // ── Internal Helpers ───────────────────────────────────

    /**
     * Assert the connection is in a usable state.
     */
    private assertConnected(handle: MCPConnectionHandle): void {
        if (handle.state !== "connected") {
            throw new Error(
                `MCP server "${handle.config.id}" is not connected (state: ${handle.state}). ` +
                "Call connect() or reconnect() first."
            );
        }
    }

    /**
     * Send a JSON-RPC style request to the MCP server.
     * Uses HTTP POST for SSE transport.
     */
    private async sendRequest(
        url: string,
        method: string,
        params: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method,
                params,
                id: Date.now(),
            }),
        });

        if (!response.ok) {
            throw new Error(
                `MCP server returned HTTP ${response.status}: ${response.statusText}`
            );
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(
                `MCP server error: ${data.error.message ?? JSON.stringify(data.error)}`
            );
        }

        return data.result ?? data;
    }

    /**
     * Send a request with a timeout.
     */
    private async sendRequestWithTimeout(
        url: string,
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number
    ): Promise<Record<string, unknown>> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method,
                    params,
                    id: Date.now(),
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(
                    `MCP server returned HTTP ${response.status}: ${response.statusText}`
                );
            }

            const data = await response.json();

            if (data.error) {
                throw new Error(
                    `MCP server error: ${data.error.message ?? JSON.stringify(data.error)}`
                );
            }

            return data.result ?? data;
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(
                    `MCP tool call timed out after ${timeoutMs}ms`
                );
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Ping the server to check reachability.
     */
    private async pingServer(url: string): Promise<void> {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "ping",
                    params: {},
                    id: Date.now(),
                }),
                signal: AbortSignal.timeout(5000),
            });
            // Any response (even 4xx) means the server is reachable
            if (!response.ok && response.status >= 500) {
                throw new Error(`Server returned ${response.status}`);
            }
        } catch (error) {
            if (error instanceof Error && error.name === "TimeoutError") {
                throw new Error("Connection timed out");
            }
            throw error;
        }
    }

    /**
     * Validate that a tool call response has a valid structure.
     * MCP tool responses should have content field.
     */
    private validateToolResponse(response: unknown): void {
        if (response === null || response === undefined) {
            throw new Error(
                "Invalid tool response: received null or undefined"
            );
        }

        // Minimal validation — response must be an object or array
        if (typeof response !== "object") {
            throw new Error(
                `Invalid tool response: expected object, got ${typeof response}`
            );
        }
    }

    /**
     * Sleep utility.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
