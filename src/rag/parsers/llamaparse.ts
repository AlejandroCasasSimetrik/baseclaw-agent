/**
 * Level 5 — LlamaParse Document Parser
 *
 * Integrates with LlamaParse for parsing 160+ document formats:
 *   - PDFs with tables, images, charts → structured Markdown
 *   - DOCX, PPTX, XLSX → content and structure preserved
 *
 * Falls back to raw text extraction if LLAMAPARSE_API_KEY is missing.
 */

import { traceable } from "langsmith/traceable";
import { getLlamaParseApiKey } from "../config.js";
import type { ParseResult } from "../types.js";

/**
 * Parse a document using LlamaParse.
 *
 * If the LlamaParse API key is not available, falls back to
 * decoding the buffer as UTF-8 text.
 */
export const parseDocument = traceable(
    async (
        filename: string,
        content: Buffer,
        fileType: string
    ): Promise<ParseResult> => {
        const apiKey = getLlamaParseApiKey();

        if (apiKey) {
            try {
                // Dynamic import to avoid hard dependency
                const { LlamaParseReader } = await import("llamaindex");

                const reader = new LlamaParseReader({
                    apiKey,
                    resultType: "markdown",
                });

                // LlamaParseReader works with file paths or buffers
                // Write to a temp file for parsing
                const { writeFileSync, unlinkSync } = await import("fs");
                const { join } = await import("path");
                const { tmpdir } = await import("os");

                const tempPath = join(tmpdir(), `llamaparse-${Date.now()}-${filename}`);
                writeFileSync(tempPath, content);

                try {
                    const documents = await reader.loadData(tempPath);
                    const text = documents.map((doc) => doc.text).join("\n---PAGE---\n");

                    return {
                        text,
                        parserMetadata: {
                            parser: "llamaparse",
                            fileType,
                            pageCount: documents.length,
                            resultType: "markdown",
                        },
                        parserUsed: "llamaparse",
                    };
                } finally {
                    try {
                        unlinkSync(tempPath);
                    } catch {
                        // Best-effort cleanup
                    }
                }
            } catch (error) {
                // LlamaParse failed — fall through to text fallback
                const errMsg = error instanceof Error ? error.message : String(error);
                return {
                    text: content.toString("utf-8"),
                    parserMetadata: {
                        parser: "text-fallback",
                        fileType,
                        llamaparseError: errMsg,
                    },
                    parserUsed: "text-fallback",
                };
            }
        }

        // No API key — use raw text fallback
        return {
            text: content.toString("utf-8"),
            parserMetadata: {
                parser: "text-fallback",
                fileType,
                reason: "LLAMAPARSE_API_KEY not set",
            },
            parserUsed: "text-fallback",
        };
    },
    { name: "rag.parse.document", run_type: "chain" }
);
