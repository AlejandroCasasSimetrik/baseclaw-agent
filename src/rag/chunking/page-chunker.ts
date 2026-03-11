/**
 * Level 5 — Page-Level Chunker
 *
 * Splits PDF content at page boundaries.
 * LlamaParse outputs pages separated by `\n---PAGE---\n`.
 * Tables and content within a page stay intact.
 */

import type { RAGChunk, RAGChunkMetadata } from "../types.js";

/**
 * Page boundary marker output by LlamaParse.
 */
const PAGE_SEPARATOR = "\n---PAGE---\n";

/**
 * Split parsed PDF text into page-level chunks.
 *
 * Each page becomes one chunk. Empty pages are skipped.
 */
export function chunkByPage(
    text: string,
    baseMetadata: Omit<RAGChunkMetadata, "chunk_index" | "chunk_total">
): RAGChunk[] {
    const pages = text.split(PAGE_SEPARATOR).filter((p) => p.trim().length > 0);

    const totalChunks = pages.length;

    return pages.map((pageText, index) => ({
        text: pageText.trim(),
        metadata: {
            ...baseMetadata,
            chunk_index: String(index),
            chunk_total: String(totalChunks),
        } as RAGChunkMetadata,
    }));
}
