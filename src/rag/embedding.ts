/**
 * Level 5 — Batch Embedding
 *
 * Embeds RAG chunks in batches using a configurable embedding model.
 * Uses OpenAI embeddings (via @langchain/openai) with:
 *   - Configurable model name (RAG_EMBEDDING_MODEL env var)
 *   - Configurable batch size (RAG_EMBEDDING_BATCH_SIZE env var)
 *
 * Traced as a LangSmith span with model, batch size, duration, tokens.
 */

import { traceable } from "langsmith/traceable";
import { EMBEDDING_MODEL, EMBEDDING_BATCH_SIZE } from "./config.js";
import type { RAGChunk } from "./types.js";

/** Embedding result for a single chunk */
export interface ChunkEmbedding {
    chunkIndex: number;
    vector: number[];
}

/**
 * Batch-embed an array of RAG chunks.
 *
 * Processes chunks in batches of EMBEDDING_BATCH_SIZE.
 * Returns an array of { chunkIndex, vector } tuples.
 *
 * Traced as a LangSmith span.
 */
export const embedChunks = traceable(
    async (chunks: RAGChunk[]): Promise<ChunkEmbedding[]> => {
        if (chunks.length === 0) return [];

        const { OpenAIEmbeddings } = await import("@langchain/openai");
        const embeddings = new OpenAIEmbeddings({ model: EMBEDDING_MODEL });

        const results: ChunkEmbedding[] = [];

        // Process in batches
        for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
            const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
            const texts = batch.map((c) => c.text);

            const vectors = await embeddings.embedDocuments(texts);

            for (let j = 0; j < batch.length; j++) {
                results.push({
                    chunkIndex: i + j,
                    vector: vectors[j],
                });
            }
        }

        return results;
    },
    { name: "rag.embed", run_type: "chain" }
);

/**
 * Get the configured embedding model name (for trace metadata).
 */
export function getEmbeddingModelName(): string {
    return EMBEDDING_MODEL;
}
