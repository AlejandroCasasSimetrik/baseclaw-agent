/**
 * Level 5 — RAG Storage (Pinecone)
 *
 * Upserts chunk vectors to the Pinecone `rag` namespace.
 * Uses the existing Pinecone client from Level 3.
 *
 * Traced as a LangSmith span.
 */

import { traceable } from "langsmith/traceable";
import { getIndex } from "../memory/semantic/pinecone.js";
import type { RAGChunk } from "./types.js";
import type { ChunkEmbedding } from "./embedding.js";

/**
 * Generate a unique vector ID for a RAG chunk.
 */
function generateVectorId(
    filename: string,
    chunkIndex: number,
    timestamp: string
): string {
    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 50);
    return `rag-${safeName}-${chunkIndex}-${timestamp.replace(/[^0-9]/g, "")}`;
}

/**
 * Upsert chunk vectors to the Pinecone `rag` namespace.
 *
 * Each vector includes the full RAGChunkMetadata as Pinecone metadata.
 * Vectors are immediately queryable after upsert.
 *
 * Traced as a LangSmith span.
 */
export const storeChunks = traceable(
    async (
        chunks: RAGChunk[],
        embeddings: ChunkEmbedding[],
        filename: string,
        timestamp: string
    ): Promise<{ vectorCount: number }> => {
        if (chunks.length === 0 || embeddings.length === 0) {
            return { vectorCount: 0 };
        }

        const index = getIndex();
        const ragNamespace = index.namespace("rag");

        // Build Pinecone records
        const records = chunks.map((chunk, i) => {
            const embedding = embeddings[i];
            if (!embedding) {
                throw new Error(`Missing embedding for chunk ${i}`);
            }

            return {
                id: generateVectorId(filename, i, timestamp),
                values: embedding.vector,
                metadata: {
                    ...chunk.metadata,
                    // Store chunk text in metadata for retrieval
                    text: chunk.text.slice(0, 40000), // Pinecone metadata size limit
                } as Record<string, string>,
            };
        });

        // Upsert in batches of 100 (Pinecone limit)
        const BATCH_SIZE = 100;
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            await (ragNamespace as any).upsert({ records: batch });
        }

        return { vectorCount: records.length };
    },
    { name: "rag.store", run_type: "chain" }
);
