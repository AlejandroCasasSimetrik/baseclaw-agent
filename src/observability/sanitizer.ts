/**
 * Level 4 — Trace Sanitization
 *
 * Security-critical: runs BEFORE traces reach LangSmith.
 * Strips API keys, PII, connection strings, and .env values
 * from all trace payloads.
 */

const REDACTED = "[REDACTED]";

// ── Regex Patterns ──────────────────────────────────────────

/** OpenAI API keys: sk-... or sk-proj-... */
const OPENAI_KEY_PATTERN = /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g;

/** Pinecone API keys: pcsk_... */
const PINECONE_KEY_PATTERN = /pcsk_[A-Za-z0-9_-]{10,}/g;

/** LangSmith API keys: ls__... or lsv2_... */
const LANGSMITH_KEY_PATTERN = /(?:ls__|lsv2_)[A-Za-z0-9_-]{10,}/g;

/** ElevenLabs API keys (el_ or sk_ prefix) */
const ELEVENLABS_KEY_PATTERN = /(?:el_|sk_)[A-Za-z0-9_-]{20,}/g;

/** Deepgram API keys */
const DEEPGRAM_KEY_PATTERN = /(?:dg_)[A-Za-z0-9_-]{20,}/g;

/** Generic API key patterns: key=..., api_key=..., apikey=... */
const GENERIC_KEY_PATTERN =
    /(?:api[_-]?key|secret|token|password|credential)[\s]*[=:]\s*["']?[A-Za-z0-9_\-./+]{8,}["']?/gi;

/** PostgreSQL connection strings */
const POSTGRES_CONN_PATTERN =
    /postgres(?:ql)?:\/\/[^\s"'`]+/gi;

/** Email addresses */
const EMAIL_PATTERN =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** US phone numbers (various formats) */
const PHONE_PATTERN =
    /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;

// All patterns in order of priority
const SANITIZATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: OPENAI_KEY_PATTERN, label: "OPENAI_KEY" },
    { pattern: PINECONE_KEY_PATTERN, label: "PINECONE_KEY" },
    { pattern: LANGSMITH_KEY_PATTERN, label: "LANGSMITH_KEY" },
    { pattern: ELEVENLABS_KEY_PATTERN, label: "ELEVENLABS_KEY" },
    { pattern: DEEPGRAM_KEY_PATTERN, label: "DEEPGRAM_KEY" },
    { pattern: POSTGRES_CONN_PATTERN, label: "DB_CONNECTION" },
    { pattern: GENERIC_KEY_PATTERN, label: "API_KEY" },
    { pattern: EMAIL_PATTERN, label: "EMAIL" },
    { pattern: PHONE_PATTERN, label: "PHONE" },
];

// ── Known .env values to strip ──────────────────────────────

/** Env var names whose values should be stripped from traces */
const SENSITIVE_ENV_VARS = [
    "OPENAI_API_KEY",
    "LANGCHAIN_API_KEY",
    "PINECONE_API_KEY",
    "DATABASE_URL",
    "ELEVENLABS_API_KEY",
    "DEEPGRAM_API_KEY",
    "LANGSMITH_ALERT_WEBHOOK_URL",
    "LLAMAPARSE_API_KEY",
] as const;

/**
 * Get known sensitive values from environment.
 * Cached at module load to avoid repeated env reads.
 */
function getSensitiveValues(): string[] {
    const values: string[] = [];
    for (const varName of SENSITIVE_ENV_VARS) {
        const val = process.env[varName];
        if (val && val.length > 4) {
            values.push(val);
        }
    }
    return values;
}

// ── Core Sanitizer ──────────────────────────────────────────

/**
 * Sanitize a string by replacing sensitive patterns.
 */
export function sanitizeString(input: string): string {
    let result = input;

    // First: strip known .env values (exact match)
    const sensitiveValues = getSensitiveValues();
    for (const val of sensitiveValues) {
        if (result.includes(val)) {
            result = result.replaceAll(val, REDACTED);
        }
    }

    // Then: strip regex patterns
    for (const { pattern } of SANITIZATION_PATTERNS) {
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
        result = result.replace(pattern, REDACTED);
    }

    return result;
}

/**
 * Deep-walk an object and sanitize all string values.
 * Returns a new object — does NOT mutate the input.
 */
export function sanitizeTraceData<T>(data: T): T {
    if (data === null || data === undefined) {
        return data;
    }

    if (typeof data === "string") {
        return sanitizeString(data) as T;
    }

    if (Array.isArray(data)) {
        return data.map((item) => sanitizeTraceData(item)) as T;
    }

    if (typeof data === "object") {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            sanitized[key] = sanitizeTraceData(value);
        }
        return sanitized as T;
    }

    return data;
}

/**
 * Check if a string contains any sensitive patterns.
 * Used in tests to verify sanitization is working.
 */
export function containsSensitiveData(input: string): boolean {
    // Check known env values
    for (const val of getSensitiveValues()) {
        if (input.includes(val)) return true;
    }

    // Check regex patterns
    for (const { pattern } of SANITIZATION_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) return true;
    }

    return false;
}

/**
 * Get the redaction marker used by the sanitizer.
 */
export function getRedactedMarker(): string {
    return REDACTED;
}
