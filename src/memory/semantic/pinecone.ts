/**
 * Level 3 — Semantic Memory (Pinecone)
 *
 * Two namespaces in the same Pinecone index:
 *   - `rag`: document embeddings (Level 4 will populate; read-only for now)
 *   - `knowledge`: distilled insights, validated by Reviewer only
 *
 * Write access:
 *   - `knowledge`: Reviewer Agent + distillation process only
 *   - `rag`: RAG pipeline only (Level 4)
 *
 * Read access: all agents, both namespaces.
 */

import { Pinecone, type RecordMetadata } from "@pinecone-database/pinecone";
import type {
    SemanticNamespace,
    SemanticVectorMetadata,
    MemoryQueryResult,
} from "../types.js";

// ── Allowed writers for knowledge namespace ────────────────
// ── Allowed writers for knowledge namespace ────────────────
// All agents can write conversation memories; reviewer/distillation write validated insights
const KNOWLEDGE_WRITERS = new Set([
    "reviewer", "distillation",
    "conversation", "ideation", "planning", "execution", "gate",
]);

// ── Pinecone Client Singleton ──────────────────────────────

let _client: Pinecone | null = null;

/**
 * Get or create the Pinecone client singleton.
 * Requires PINECONE_API_KEY environment variable.
 */
export function getPineconeClient(): Pinecone {
    if (!_client) {
        const apiKey = process.env.PINECONE_API_KEY;
        if (!apiKey) {
            throw new Error(
                "PINECONE_API_KEY environment variable is required for Semantic Memory. " +
                "Add it to your .env file."
            );
        }
        _client = new Pinecone({ apiKey });
    }
    return _client;
}

/**
 * Reset the Pinecone client singleton (used in tests).
 */
export function resetPineconeClient(): void {
    _client = null;
}

/**
 * Get the Pinecone index handle.
 *
 * Accepts an optional indexName for dynamic per-agent index creation.
 * Each specialized agent built on Base Claw can provide its own index name.
 * Falls back to PINECONE_INDEX env var, then "baseclaw" default.
 */
export function getIndex(indexName?: string) {
    const name = indexName ?? process.env.PINECONE_INDEX ?? "baseclaw";
    return getPineconeClient().index<SemanticVectorMetadata>(name);
}

/**
 * Get a namespaced handle for the index.
 *
 * @param ns - Namespace: 'rag' or 'knowledge'
 * @param indexName - Optional custom index name (for specialized agents)
 */
export function getNamespace(ns: SemanticNamespace, indexName?: string) {
    return getIndex(indexName).namespace(ns);
}

// ── Write Operations ───────────────────────────────────────

/**
 * Upsert vectors to the `knowledge` namespace.
 *
 * RESTRICTED: Only Reviewer Agent and distillation process can write.
 * Throws if callerAgent is not in the allowed set.
 */
export async function upsertToKnowledge(
    vectors: Array<{
        id: string;
        values: number[];
        metadata: SemanticVectorMetadata;
    }>,
    callerAgent: string
): Promise<void> {
    if (!KNOWLEDGE_WRITERS.has(callerAgent)) {
        throw new Error(
            `Access denied: agent "${callerAgent}" cannot write to knowledge namespace. ` +
            `Only ${[...KNOWLEDGE_WRITERS].join(", ")} agents have write access.`
        );
    }

    const index = getIndex();
    const records = vectors.map((v) => ({
        id: v.id,
        values: v.values,
        metadata: v.metadata as unknown as Record<string, string>,
    }));
    await (index.namespace("knowledge") as any).upsert({ records });
}

// ── Query Operations ───────────────────────────────────────

/**
 * Query semantic memory in a specific namespace.
 *
 * @param queryVector - The query embedding vector
 * @param namespace - 'rag' or 'knowledge'
 * @param topK - Number of results to return (default: 5)
 * @param tenantId - Optional tenant filter via metadata
 * @param additionalFilters - Optional additional metadata filters (Level 5)
 */
export async function querySemanticMemory(
    queryVector: number[],
    namespace: SemanticNamespace,
    topK: number = 5,
    tenantId?: string,
    additionalFilters?: Record<string, string>
): Promise<MemoryQueryResult[]> {
    const ns = getNamespace(namespace);

    const queryOptions: {
        vector: number[];
        topK: number;
        includeMetadata: boolean;
        filter?: Record<string, unknown>;
    } = {
        vector: queryVector,
        topK,
        includeMetadata: true,
    };

    // Build composite filter from tenantId + additional filters
    const filterConditions: Record<string, unknown>[] = [];

    if (tenantId) {
        filterConditions.push({ tenant_id: { $eq: tenantId } });
        // Also support legacy "tenantId" field for knowledge namespace
        if (namespace === "knowledge") {
            filterConditions.pop();
            filterConditions.push({ tenantId: { $eq: tenantId } });
        }
    }

    if (additionalFilters) {
        for (const [key, value] of Object.entries(additionalFilters)) {
            if (value) {
                filterConditions.push({ [key]: { $eq: value } });
            }
        }
    }

    if (filterConditions.length === 1) {
        queryOptions.filter = filterConditions[0];
    } else if (filterConditions.length > 1) {
        queryOptions.filter = { $and: filterConditions };
    }

    const results = await ns.query(queryOptions);

    return (results.matches || []).map((match) => ({
        id: match.id,
        score: match.score ?? 0,
        content: (match.metadata as Record<string, string>)?.text,
        metadata: (match.metadata as SemanticVectorMetadata) ?? {
            source: "",
            timestamp: "",
            agentType: "",
            taskId: "",
            tenantId: "",
            namespace,
        },
    }));
}

/**
 * Delete a vector by ID from the `knowledge` namespace.
 */
export async function deleteFromKnowledge(id: string): Promise<void> {
    const index = getIndex();
    await index.namespace("knowledge").deleteMany({ ids: [id] } as any);
}

// ── Embedding Generation ───────────────────────────────────

/**
 * Generate an embedding vector for a text string.
 *
 * Uses OpenAI's text-embedding-3-small model (1536 dimensions).
 * Falls back gracefully if @langchain/openai is available.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    const { OpenAIEmbeddings } = await import("@langchain/openai");

    // Use OPENAI_EMBEDDING_KEY for real OpenAI embeddings.
    // Must also override baseURL because OPENAI_BASE_URL is set to Cerebras
    // (which doesn't support embeddings).
    const apiKey = process.env.OPENAI_EMBEDDING_KEY || process.env.OPENAI_API_KEY;
    const embeddings = new OpenAIEmbeddings({
        model: "text-embedding-3-small",
        openAIApiKey: apiKey,
        configuration: {
            baseURL: "https://api.openai.com/v1",
        },
    });
    return embeddings.embedQuery(text);
}
