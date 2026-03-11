/**
 * Level 5 — Code File Parser
 *
 * Simple text reader with language detection metadata.
 * Code files are stored as raw text with the detected
 * programming language attached as metadata.
 */

import { traceable } from "langsmith/traceable";
import type { ParseResult } from "../types.js";

/**
 * Maps file extensions to language names.
 */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    java: "java",
    go: "go",
    rs: "rust",
    rb: "ruby",
    php: "php",
    c: "c",
    cpp: "c++",
    h: "c-header",
    hpp: "c++-header",
    cs: "csharp",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "shell",
    bash: "bash",
    sql: "sql",
    r: "r",
    lua: "lua",
    dart: "dart",
    zig: "zig",
    toml: "toml",
    ini: "ini",
    cfg: "config",
};

/**
 * Detect the programming language from a file extension.
 */
export function detectLanguage(extension: string): string {
    const ext = extension.toLowerCase().replace(/^\./, "");
    return EXTENSION_LANGUAGE_MAP[ext] ?? "unknown";
}

/**
 * Parse a code file — raw text with language detection.
 */
export const parseCodeFile = traceable(
    async (
        filename: string,
        content: Buffer,
        fileType: string
    ): Promise<ParseResult> => {
        const text = content.toString("utf-8");
        const language = detectLanguage(fileType);

        return {
            text,
            parserMetadata: {
                parser: "code-reader",
                fileType,
                language,
                lineCount: text.split("\n").length,
                charCount: text.length,
            },
            parserUsed: "code-reader",
        };
    },
    { name: "rag.parse.code", run_type: "chain" }
);
