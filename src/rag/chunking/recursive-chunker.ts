/**
 * Level 5 — Recursive Text Chunker
 *
 * Splits text documents (DOCX, TXT, MD, HTML) using recursive
 * character splitting with configurable:
 *   - Target chunk size (400-512 tokens ≈ 1600-2048 chars)
 *   - Overlap (10-20% of target size)
 *   - Separator priority: ["\n\n", "\n", ". ", " "]
 */

import { RECURSIVE_CHUNK_CONFIG } from "../config.js";
import type { RAGChunk, RAGChunkMetadata } from "../types.js";

/**
 * Recursively split text into chunks using separator hierarchy.
 *
 * Tries the first separator. If chunks are still too large,
 * recursively splits with the next separator.
 */
function recursiveSplit(
    text: string,
    targetSize: number,
    separators: string[]
): string[] {
    // Base case: text fits in one chunk
    if (text.length <= targetSize) {
        return [text];
    }

    // No more separators — hard split at targetSize
    if (separators.length === 0) {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += targetSize) {
            chunks.push(text.slice(i, i + targetSize));
        }
        return chunks;
    }

    const [separator, ...remainingSeparators] = separators;
    const parts = text.split(separator);

    // If the separator didn't split anything, try next separator
    if (parts.length <= 1) {
        return recursiveSplit(text, targetSize, remainingSeparators);
    }

    // Merge parts into chunks that fit within targetSize
    const chunks: string[] = [];
    let currentChunk = "";

    for (const part of parts) {
        const candidate = currentChunk
            ? currentChunk + separator + part
            : part;

        if (candidate.length <= targetSize) {
            currentChunk = candidate;
        } else {
            if (currentChunk) {
                chunks.push(currentChunk);
            }
            // If single part is still too large, recursively split it
            if (part.length > targetSize) {
                const subChunks = recursiveSplit(part, targetSize, remainingSeparators);
                chunks.push(...subChunks);
                currentChunk = "";
            } else {
                currentChunk = part;
            }
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * Add overlap between chunks.
 * Takes the last `overlapSize` characters from the previous chunk
 * and prepends to the current chunk.
 */
function addOverlap(chunks: string[], overlapSize: number): string[] {
    if (chunks.length <= 1 || overlapSize <= 0) {
        return chunks;
    }

    const result: string[] = [chunks[0]];

    for (let i = 1; i < chunks.length; i++) {
        const prevChunk = chunks[i - 1];
        const overlap = prevChunk.slice(-overlapSize);
        result.push(overlap + chunks[i]);
    }

    return result;
}

/**
 * Split text into chunks using recursive character splitting.
 *
 * Uses configurable target size, overlap, and separator priority
 * from RECURSIVE_CHUNK_CONFIG.
 */
export function chunkRecursive(
    text: string,
    baseMetadata: Omit<RAGChunkMetadata, "chunk_index" | "chunk_total">,
    config?: {
        targetSize?: number;
        overlapFraction?: number;
        separators?: string[];
    }
): RAGChunk[] {
    const targetSize = config?.targetSize ?? RECURSIVE_CHUNK_CONFIG.targetSize;
    const overlapFraction = config?.overlapFraction ?? RECURSIVE_CHUNK_CONFIG.overlapFraction;
    const separators = config?.separators ?? RECURSIVE_CHUNK_CONFIG.separators;

    const overlapSize = Math.round(targetSize * overlapFraction);

    // Split into raw chunks
    let rawChunks = recursiveSplit(text, targetSize, separators);

    // Add overlap
    rawChunks = addOverlap(rawChunks, overlapSize);

    // Filter empties
    rawChunks = rawChunks.filter((c) => c.trim().length > 0);

    const totalChunks = rawChunks.length;

    return rawChunks.map((chunkText, index) => ({
        text: chunkText.trim(),
        metadata: {
            ...baseMetadata,
            chunk_index: String(index),
            chunk_total: String(totalChunks),
        } as RAGChunkMetadata,
    }));
}
