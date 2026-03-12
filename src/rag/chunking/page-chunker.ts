/**
 * Level 5 — Page-Level Chunker
 *
 * Splits PDF content at page boundaries.
 * LlamaParse outputs pages separated by `\n---PAGE---\n`.
 * Tables and content within a page stay intact.
 *
 * When the text-fallback parser is used (no page markers), or when
 * a single page is too large for the embedding API, the chunker
 * automatically sub-splits oversized pages using recursive text
 * splitting to stay under the OpenAI token limit.
 */

import { chunkRecursive } from "./recursive-chunker.js";
import type { RAGChunk, RAGChunkMetadata } from "../types.js";

/**
 * Page boundary marker output by LlamaParse.
 */
const PAGE_SEPARATOR = "\n---PAGE---\n";

/**
 * Max characters per chunk for embedding safety.
 * OpenAI limit is 300k tokens ≈ ~1.2M chars. We use a conservative
 * limit of 500k chars (~125k tokens) to stay well under the limit
 * and produce reasonably-sized chunks for semantic search quality.
 */
const MAX_CHUNK_CHARS = 500_000;

/**
 * Split parsed PDF text into page-level chunks.
 *
 * Each page becomes one chunk. Empty pages are skipped.
 * Oversized pages are sub-split using recursive text splitting.
 */
export function chunkByPage(
    text: string,
    baseMetadata: Omit<RAGChunkMetadata, "chunk_index" | "chunk_total">
): RAGChunk[] {
    const pages = text.split(PAGE_SEPARATOR).filter((p) => p.trim().length > 0);

    // If we got only 1 "page" and it's large, the parser didn't produce
    // page markers (text-fallback). Use recursive splitting instead.
    if (pages.length === 1 && pages[0].length > MAX_CHUNK_CHARS) {
        console.log(`[RAG chunker] Single page too large (${pages[0].length} chars), falling back to recursive splitting`);
        return chunkRecursive(text, baseMetadata);
    }

    // Sub-split any oversized pages
    const allChunks: { text: string }[] = [];
    for (const pageText of pages) {
        const trimmed = pageText.trim();
        if (trimmed.length <= MAX_CHUNK_CHARS) {
            allChunks.push({ text: trimmed });
        } else {
            // Page is too large — sub-split it
            const subChunks = chunkRecursive(trimmed, baseMetadata);
            for (const sc of subChunks) {
                allChunks.push({ text: sc.text });
            }
        }
    }

    const totalChunks = allChunks.length;

    return allChunks.map((chunk, index) => ({
        text: chunk.text,
        metadata: {
            ...baseMetadata,
            chunk_index: String(index),
            chunk_total: String(totalChunks),
        } as RAGChunkMetadata,
    }));
}
