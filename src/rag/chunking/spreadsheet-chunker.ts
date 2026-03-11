/**
 * Level 5 — Spreadsheet Row-Group Chunker
 *
 * Splits tabular data (CSV, XLSX parsed output) into chunks
 * of N rows each, with headers attached to every chunk so
 * each chunk is self-contained for embedding.
 */

import { ROW_GROUP_CONFIG } from "../config.js";
import type { RAGChunk, RAGChunkMetadata } from "../types.js";

/**
 * Split tabular/spreadsheet text into row-group chunks.
 *
 * Assumes the first non-empty line is the header row.
 * Each chunk contains the header + N data rows.
 */
export function chunkByRows(
    text: string,
    baseMetadata: Omit<RAGChunkMetadata, "chunk_index" | "chunk_total">,
    rowsPerChunk?: number
): RAGChunk[] {
    const rows = text.split("\n").filter((r) => r.trim().length > 0);

    if (rows.length === 0) {
        return [];
    }

    const header = rows[0];
    const dataRows = rows.slice(1);

    if (dataRows.length === 0) {
        // Only header — single chunk
        return [
            {
                text: header,
                metadata: {
                    ...baseMetadata,
                    chunk_index: "0",
                    chunk_total: "1",
                } as RAGChunkMetadata,
            },
        ];
    }

    const groupSize = rowsPerChunk ?? ROW_GROUP_CONFIG.rowsPerChunk;
    const chunks: string[] = [];

    for (let i = 0; i < dataRows.length; i += groupSize) {
        const group = dataRows.slice(i, i + groupSize);
        chunks.push([header, ...group].join("\n"));
    }

    const totalChunks = chunks.length;

    return chunks.map((chunkText, index) => ({
        text: chunkText,
        metadata: {
            ...baseMetadata,
            chunk_index: String(index),
            chunk_total: String(totalChunks),
        } as RAGChunkMetadata,
    }));
}
