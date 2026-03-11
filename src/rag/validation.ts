/**
 * Level 5 — File Validation
 *
 * Validates files before RAG ingestion:
 *   1. Size limit check
 *   2. File type allowlist check
 *   3. Credential/secret scanning (flags, does not block)
 *
 * Traced as a LangSmith span.
 */

import { traceable } from "langsmith/traceable";
import { MAX_FILE_SIZE_BYTES, isFileTypeAllowed, getFileExtension } from "./config.js";
import type { ValidationResult } from "./types.js";

// ── Credential Detection Patterns ──────────────────────────

const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, label: "OpenAI API Key" },
    { pattern: /pcsk_[A-Za-z0-9_-]{10,}/g, label: "Pinecone API Key" },
    { pattern: /(?:ls__|lsv2_)[A-Za-z0-9_-]{10,}/g, label: "LangSmith API Key" },
    { pattern: /(?:el_)[A-Za-z0-9_-]{20,}/g, label: "ElevenLabs API Key" },
    { pattern: /AKIA[0-9A-Z]{16}/g, label: "AWS Access Key" },
    { pattern: /ghp_[A-Za-z0-9]{36,}/g, label: "GitHub Personal Access Token" },
    { pattern: /glpat-[A-Za-z0-9_-]{20,}/g, label: "GitLab Personal Access Token" },
    {
        pattern: /(?:api[_-]?key|secret|token|password|credential)\s*[=:]\s*["']?[A-Za-z0-9_\-./+]{16,}["']?/gi,
        label: "Generic Credential",
    },
    { pattern: /postgres(?:ql)?:\/\/[^\s"'`]+/gi, label: "Database Connection String" },
];

/**
 * Scan text content for credential patterns.
 * Returns array of warning labels for each detected credential type.
 */
export function scanForCredentials(content: string): string[] {
    const warnings: string[] = [];
    for (const { pattern, label } of CREDENTIAL_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
            warnings.push(label);
        }
    }
    return warnings;
}

/**
 * Validate a file for RAG ingestion.
 *
 * Checks:
 *   1. File size ≤ MAX_FILE_SIZE_BYTES
 *   2. File extension is in the allowlist
 *   3. Credential scan (warnings only, does not reject)
 *
 * Traced as a LangSmith child span.
 */
export const validateFile = traceable(
    async (
        filename: string,
        sizeBytes: number,
        content: Buffer
    ): Promise<ValidationResult> => {
        // 1. Size check
        if (sizeBytes > MAX_FILE_SIZE_BYTES) {
            return {
                valid: false,
                reason: `File size ${sizeBytes} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes (${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB)`,
                credentialWarnings: [],
            };
        }

        // 2. Type check
        const extension = getFileExtension(filename);
        if (!extension) {
            return {
                valid: false,
                reason: `File "${filename}" has no extension. Only supported file types are allowed.`,
                credentialWarnings: [],
            };
        }

        if (!isFileTypeAllowed(extension)) {
            return {
                valid: false,
                reason: `File type ".${extension}" is not supported. Upload a supported format (PDF, DOCX, TXT, code files, etc.)`,
                credentialWarnings: [],
            };
        }

        // 3. Credential scan (warning only — does not block ingestion)
        let credentialWarnings: string[] = [];
        try {
            const textContent = content.toString("utf-8");
            credentialWarnings = scanForCredentials(textContent);
        } catch {
            // Binary file — skip credential scan
        }

        return {
            valid: true,
            credentialWarnings,
        };
    },
    { name: "rag.validation", run_type: "chain" }
);
