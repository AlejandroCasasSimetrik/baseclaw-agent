/**
 * Inspector Sanitizer — Server-side secret removal.
 *
 * SECURITY: All data sent to the dev console must pass through
 * these functions. No raw credentials, API keys, or tokens
 * should ever reach the browser.
 */

import type { MCPServerConfig } from "../mcp/types.js";

// ── Patterns that look like secrets ────────────────────────

const SECRET_PATTERNS = [
    /sk-[A-Za-z0-9]{20,}/g,           // OpenAI keys
    /sk-proj-[A-Za-z0-9_-]{20,}/g,    // OpenAI project keys
    /ls__[A-Za-z0-9]{20,}/g,          // LangSmith keys
    /xoxb-[A-Za-z0-9-]+/g,            // Slack Bot tokens
    /ghp_[A-Za-z0-9]{36,}/g,          // GitHub PATs
    /gho_[A-Za-z0-9]{36,}/g,          // GitHub OAuth tokens
    /Bearer\s+[A-Za-z0-9._\-]+/gi,    // Bearer tokens
    /[A-Za-z0-9+/]{40,}={0,2}/g,      // Base64 long strings (potential secrets)
    /password=[^&\s]+/gi,              // URL password params
    /token=[^&\s]+/gi,                 // URL token params
    /key=[^&\s]+/gi,                   // URL key params
];

/**
 * Mask a URL by removing credentials from userinfo.
 * e.g. "http://user:pass@host:5432/db" → "http://***:***@host:5432/db"
 */
export function sanitizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.username || parsed.password) {
            parsed.username = parsed.username ? "***" : "";
            parsed.password = parsed.password ? "***" : "";
        }
        // Also mask any query params that look like secrets
        for (const [key] of parsed.searchParams) {
            const lower = key.toLowerCase();
            if (
                lower.includes("key") ||
                lower.includes("token") ||
                lower.includes("secret") ||
                lower.includes("password") ||
                lower.includes("credential")
            ) {
                parsed.searchParams.set(key, "***");
            }
        }
        return parsed.toString();
    } catch {
        // Not a valid URL — still try to mask credentials
        return url
            .replace(/\/\/[^:]+:[^@]+@/, "//***:***@")
            .replace(/password=[^&\s]+/gi, "password=***")
            .replace(/token=[^&\s]+/gi, "token=***")
            .replace(/key=[^&\s]+/gi, "key=***");
    }
}

/**
 * Sanitize an MCP server config for the dev console.
 * - Strips authConfig values (shows only the env var names)
 * - Masks credentials in URLs
 * - Never exposes actual secret values
 */
export function sanitizeMCPConfig(config: MCPServerConfig): Record<string, unknown> {
    return {
        id: config.id,
        name: config.name,
        url: sanitizeUrl(config.url),
        transport: config.transport,
        agentTypes: config.agentTypes,
        description: config.description,
        // Show env var NAMES only, not values
        credentialVars: Object.keys(config.authConfig),
        credentialsConfigured: Object.entries(config.authConfig).every(
            ([, envVar]) => !!process.env[envVar]
        ),
        destructiveTools: config.destructiveTools,
    };
}

/**
 * Sanitize a string value by redacting anything that looks like a secret.
 */
export function sanitizeString(value: string): string {
    let result = value;
    for (const pattern of SECRET_PATTERNS) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;
        result = result.replace(pattern, "[REDACTED]");
    }
    return result;
}

/**
 * Sanitize an arbitrary object for display in the dev console.
 * Recursively walks the object and redacts secret-looking values.
 */
export function sanitizeObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === "string") {
        return sanitizeString(obj);
    }

    if (typeof obj === "number" || typeof obj === "boolean") {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
    }

    if (typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            const lower = key.toLowerCase();
            // Redact known secret field names entirely
            if (
                lower.includes("secret") ||
                lower.includes("password") ||
                lower.includes("credential") ||
                lower.includes("apikey") ||
                lower.includes("api_key") ||
                lower === "authorization" ||
                lower === "token"
            ) {
                result[key] = "[REDACTED]";
            } else {
                result[key] = sanitizeObject(value);
            }
        }
        return result;
    }

    return String(obj);
}

/**
 * Sanitize tool call input for the live feed.
 * Truncates long values and redacts secrets.
 */
export function sanitizeToolCallInput(
    input: Record<string, unknown>,
    maxValueLength = 200
): Record<string, unknown> {
    const sanitized = sanitizeObject(input) as Record<string, unknown>;

    // Truncate long string values
    for (const [key, value] of Object.entries(sanitized)) {
        if (typeof value === "string" && value.length > maxValueLength) {
            sanitized[key] = value.slice(0, maxValueLength) + "…";
        }
    }

    return sanitized;
}

/**
 * Create a truncated summary of tool call output.
 */
export function summarizeToolOutput(
    output: unknown,
    maxLength = 300
): string {
    if (output === null || output === undefined) return "(no output)";

    let str: string;
    if (typeof output === "string") {
        str = output;
    } else {
        try {
            str = JSON.stringify(output);
        } catch {
            str = String(output);
        }
    }

    str = sanitizeString(str);

    if (str.length > maxLength) {
        return str.slice(0, maxLength) + "…";
    }

    return str;
}
