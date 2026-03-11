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
 * Max tokens per embedding API request (OpenAI limit is 300,000).
 * We use a safe margin to account for estimation inaccuracy.
 */
const MAX_TOKENS_PER_REQUEST = 200_000;

/** Rough token estimate: ~4 characters per token for English text */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Batch-embed an array of RAG chunks.
 *
 * Uses token-aware batching — estimates token count per chunk and
 * creates sub-batches that stay under the OpenAI per-request limit.
 * Sets LangChain's internal batchSize to match each sub-batch to
 * prevent LangChain from re-batching and exceeding the token limit.
 *
 * Traced as a LangSmith span.
 */
export const embedChunks = traceable(
    async (chunks: RAGChunk[]): Promise<ChunkEmbedding[]> => {
        console.log(`[RAG embed] ████ TOKEN-AWARE BATCHING v2 ████ Received ${chunks.length} chunks, MAX_TOKENS=${MAX_TOKENS_PER_REQUEST}`);
        if (chunks.length === 0) return [];

        const { OpenAIEmbeddings } = await import("@langchain/openai");
        // Use OPENAI_EMBEDDING_KEY for real OpenAI embeddings.
        // Must also override baseURL because OPENAI_BASE_URL is set to Cerebras.
        const apiKey = process.env.OPENAI_EMBEDDING_KEY || process.env.OPENAI_API_KEY;

        const results: ChunkEmbedding[] = [];

        // Build token-aware batches
        let batchStart = 0;
        while (batchStart < chunks.length) {
            let batchEnd = batchStart;
            let batchTokens = 0;

            while (batchEnd < chunks.length) {
                const chunkTokens = estimateTokens(chunks[batchEnd].text);
                if (batchTokens + chunkTokens > MAX_TOKENS_PER_REQUEST && batchEnd > batchStart) {
                    break; // This chunk would exceed the limit, start a new batch
                }
                batchTokens += chunkTokens;
                batchEnd++;

                // Also respect the configured batch size
                if (batchEnd - batchStart >= EMBEDDING_BATCH_SIZE) break;
            }

            const batch = chunks.slice(batchStart, batchEnd);
            const texts = batch.map((c) => c.text);

            // CRITICAL: Set LangChain's internal batchSize to match our
            // token-aware batch so it sends exactly ONE API call per batch.
            // Without this, LangChain's default batchSize=512 would send
            // all texts at once, potentially exceeding the 300k token limit.
            const embeddings = new OpenAIEmbeddings({
                model: EMBEDDING_MODEL,
                openAIApiKey: apiKey,
                batchSize: texts.length,
                configuration: {
                    baseURL: "https://api.openai.com/v1",
                },
            });

            console.log(`[RAG embed] Batch ${batchStart}..${batchEnd - 1} — ${batch.length} chunks, ~${batchTokens} tokens`);
            const vectors = await embeddings.embedDocuments(texts);

            for (let j = 0; j < batch.length; j++) {
                results.push({
                    chunkIndex: batchStart + j,
                    vector: vectors[j],
                });
            }

            batchStart = batchEnd;
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
