/**
 * Level 4 — Trace Configuration
 *
 * Environment-aware LangSmith project naming and Client initialization.
 * Replaces the basic tracing setup from Level 1.
 *
 * Project naming convention: `base-agent-{environment}`
 *   - dev (default), staging, prod
 */

import { Client } from "langsmith";

export type Environment = "dev" | "staging" | "prod";

let _client: Client | null = null;

/**
 * Get the current environment from NODE_ENV.
 * Maps common values to our three environments.
 */
export function getEnvironment(): Environment {
    const env = process.env.NODE_ENV?.toLowerCase() ?? "development";
    if (env === "production" || env === "prod") return "prod";
    if (env === "staging") return "staging";
    return "dev";
}

/**
 * Get the LangSmith project name for the current environment.
 */
export function getProjectName(): string {
    return `base-agent-${getEnvironment()}`;
}

/**
 * Initialize enhanced LangSmith tracing.
 *
 * Sets environment variables for LangGraph.js auto-tracing
 * and creates a LangSmith Client singleton.
 */
export function initializeObservability(): void {
    if (process.env.LANGCHAIN_API_KEY) {
        process.env.LANGCHAIN_TRACING_V2 = "true";
        process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "true";
        // Preserve custom project name if set; otherwise default to "BaseClaw"
        // (matches Level 1 contract). Use getProjectName() for env-aware naming.
        process.env.LANGCHAIN_PROJECT =
            process.env.LANGCHAIN_PROJECT || "BaseClaw";

        console.log(
            `🔭 LangSmith tracing enabled → project: ${process.env.LANGCHAIN_PROJECT} (${getEnvironment()})`
        );
    } else {
        console.log(
            "⚠️  LANGCHAIN_API_KEY not set — LangSmith tracing disabled. Add it to .env to enable."
        );
    }
}

/**
 * Get or create the LangSmith Client singleton.
 * Falls back gracefully if API key is not set.
 */
export function getLangSmithClient(): Client | null {
    if (!process.env.LANGCHAIN_API_KEY) {
        return null;
    }
    if (!_client) {
        _client = new Client({
            apiKey: process.env.LANGCHAIN_API_KEY,
        });
    }
    return _client;
}

/**
 * Reset the client singleton (used in tests).
 */
export function resetLangSmithClient(): void {
    _client = null;
}
