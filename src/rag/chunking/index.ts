/**
 * Level 5 — Chunking Router
 *
 * Routes files to the correct chunking strategy:
 *   - PDF → page-level chunking
 *   - Text (DOCX, TXT, MD, HTML) → recursive character splitting
 *   - Code → language-aware boundary splitting
 *   - Spreadsheets (XLSX, CSV) → row-group chunking
 *   - Media → single chunk (no splitting)
 *
 * Traced as a LangSmith span.
 */

import { traceable } from "langsmith/traceable";
import {
    getChunkingStrategy,
    getFileCategory,
} from "../config.js";
import { chunkByPage } from "./page-chunker.js";
import { chunkRecursive } from "./recursive-chunker.js";
import { chunkCode } from "./code-chunker.js";
import { chunkByRows } from "./spreadsheet-chunker.js";
import type { RAGChunk, RAGChunkMetadata, ChunkingStrategy } from "../types.js";

/**
 * Chunk parsed text using the appropriate strategy for the file type.
 *
 * Returns an array of RAGChunks with full metadata.
 * Traced as a LangSmith child span.
 */
export const chunkContent = traceable(
    async (
        text: string,
        fileType: string,
        baseMetadata: Omit<RAGChunkMetadata, "chunk_index" | "chunk_total">,
        parserMetadata?: Record<string, unknown>
    ): Promise<{ chunks: RAGChunk[]; strategy: ChunkingStrategy | null }> => {
        const strategy = getChunkingStrategy(fileType);
        const category = getFileCategory(fileType);

        switch (strategy) {
            case "page-level":
                return {
                    chunks: chunkByPage(text, baseMetadata),
                    strategy: "page-level",
                };

            case "recursive-text":
                return {
                    chunks: chunkRecursive(text, baseMetadata),
                    strategy: "recursive-text",
                };

            case "code-aware": {
                const language = (parserMetadata?.language as string) ?? "unknown";
                return {
                    chunks: chunkCode(text, baseMetadata, language),
                    strategy: "code-aware",
                };
            }

            case "row-group":
                return {
                    chunks: chunkByRows(text, baseMetadata),
                    strategy: "row-group",
                };

            case null:
            default:
                // Media or unknown — single chunk
                if (text.trim().length === 0) {
                    return { chunks: [], strategy: null };
                }
                return {
                    chunks: [
                        {
                            text: text.trim(),
                            metadata: {
                                ...baseMetadata,
                                chunk_index: "0",
                                chunk_total: "1",
                            } as RAGChunkMetadata,
                        },
                    ],
                    strategy: null,
                };
        }
    },
    { name: "rag.chunk", run_type: "chain" }
);

// Re-export individual chunkers for direct use and testing
export { chunkByPage } from "./page-chunker.js";
export { chunkRecursive } from "./recursive-chunker.js";
export { chunkCode } from "./code-chunker.js";
export { chunkByRows } from "./spreadsheet-chunker.js";
