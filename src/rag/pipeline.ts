/**
 * Level 5 — RAG Pipeline Orchestrator
 *
 * End-to-end async RAG pipeline:
 *   1. Validate → pass/fail
 *   2. Parse → extract text
 *   3. Chunk → split with strategy
 *   4. Embed → batch embed
 *   5. Store → Pinecone RAG namespace
 *   6. Record → Episodic Memory file_uploads
 *   7. Notify → active agent
 *
 * Fire-and-forget: the calling agent does NOT await this pipeline.
 * All steps are traced end-to-end in LangSmith.
 */

import { traceable } from "langsmith/traceable";
import { v4 as uuidv4 } from "uuid";
import { validateFile } from "./validation.js";
import { parseFile } from "./parsers/index.js";
import { chunkContent } from "./chunking/index.js";
import { embedChunks, getEmbeddingModelName } from "./embedding.js";
import { storeChunks } from "./storage.js";
import { notifyAgent } from "./notification.js";
import { getFileExtension } from "./config.js";
import { insertFileUpload } from "../memory/episodic/queries.js";
import { sanitizeTraceData } from "../observability/sanitizer.js";
import { inspectorBus } from "../inspector/index.js";
import type { FileUploadContext, RAGPipelineResult, RAGChunkMetadata } from "./types.js";

const LOG_PREFIX = "[RAG Pipeline]";

/**
 * Run the full RAG ingestion pipeline.
 *
 * This is the main entry point for file ingestion.
 * Traced end-to-end as a LangSmith root span.
 */
export const runRAGPipeline = traceable(
    async (context: FileUploadContext): Promise<RAGPipelineResult> => {
        const startTime = Date.now();
        const traceId = uuidv4();
        const uploadTimestamp = new Date().toISOString();
        const fileType = getFileExtension(context.filename);

        try {
            console.log(`${LOG_PREFIX} Starting pipeline for "${context.filename}" (${context.sizeBytes} bytes)`);

            // ── Step 1: Validate ─────────────────────────────
            console.log(`${LOG_PREFIX} [1/7] Validating...`);
            const validation = await validateFile(
                context.filename,
                context.sizeBytes,
                context.content
            );

            if (!validation.valid) {
                console.warn(`${LOG_PREFIX} ❌ Validation failed: ${validation.reason}`);
                // Record failed validation to episodic memory
                try {
                    await insertFileUpload(context.tenantId, {
                        filename: context.filename,
                        fileType: fileType || "unknown",
                        sizeBytes: context.sizeBytes,
                        parseStatus: "rejected",
                        chunkCount: 0,
                        episodeId: context.episodeId || uuidv4(),
                        langsmithTraceId: traceId,
                    });
                } catch {
                    // DB not available — degrade gracefully
                }

                const result: RAGPipelineResult = {
                    success: false,
                    filename: context.filename,
                    chunkCount: 0,
                    chunkingStrategy: null,
                    traceId,
                    durationMs: Date.now() - startTime,
                    rejectionReason: validation.reason,
                    credentialWarnings: validation.credentialWarnings,
                };
                emitPipelineEvent(result);
                return result;
            }
            console.log(`${LOG_PREFIX} [1/7] ✓ Validation passed`);

            // ── Step 2: Parse ────────────────────────────────
            console.log(`${LOG_PREFIX} [2/7] Parsing with LlamaParse...`);
            const parseResult = await parseFile(
                context.filename,
                context.content
            );
            console.log(`${LOG_PREFIX} [2/7] ✓ Parsed (${parseResult.parserUsed}, ${parseResult.text?.length || 0} chars)`);

            if (!parseResult.text || parseResult.text.trim().length === 0) {
                console.warn(`${LOG_PREFIX} ❌ Parser returned empty text`);
                const result: RAGPipelineResult = {
                    success: false,
                    filename: context.filename,
                    chunkCount: 0,
                    chunkingStrategy: null,
                    traceId,
                    durationMs: Date.now() - startTime,
                    error: "Parser returned empty text",
                    credentialWarnings: validation.credentialWarnings,
                };
                emitPipelineEvent(result);
                return result;
            }

            // ── Step 3: Chunk ────────────────────────────────
            console.log(`${LOG_PREFIX} [3/7] Chunking...`);
            const baseMetadata: Omit<RAGChunkMetadata, "chunk_index" | "chunk_total"> = {
                source_file: context.filename,
                file_type: fileType,
                upload_timestamp: uploadTimestamp,
                active_phase: context.activePhase,
                active_agent: context.activeAgent,
                tenant_id: context.tenantId,
            };

            const { chunks, strategy } = await chunkContent(
                parseResult.text,
                fileType,
                baseMetadata,
                parseResult.parserMetadata
            );
            console.log(`${LOG_PREFIX} [3/7] ✓ ${chunks.length} chunks (strategy: ${strategy})`);

            if (chunks.length === 0) {
                console.warn(`${LOG_PREFIX} ❌ Chunking produced zero chunks`);
                const result: RAGPipelineResult = {
                    success: false,
                    filename: context.filename,
                    chunkCount: 0,
                    chunkingStrategy: strategy,
                    traceId,
                    durationMs: Date.now() - startTime,
                    error: "Chunking produced zero chunks",
                    credentialWarnings: validation.credentialWarnings,
                };
                emitPipelineEvent(result);
                return result;
            }

            // ── Step 4: Embed ────────────────────────────────
            console.log(`${LOG_PREFIX} [4/7] Embedding ${chunks.length} chunks...`);
            const embeddings = await embedChunks(chunks);
            console.log(`${LOG_PREFIX} [4/7] ✓ Embedded ${embeddings.length} chunks`);

            // ── Step 5: Store ────────────────────────────────
            console.log(`${LOG_PREFIX} [5/7] Storing in Pinecone (rag namespace)...`);
            const { vectorCount } = await storeChunks(
                chunks,
                embeddings,
                context.filename,
                uploadTimestamp
            );
            console.log(`${LOG_PREFIX} [5/7] ✓ Stored ${vectorCount} vectors`);

            // ── Step 6: Record to Episodic Memory ────────────
            console.log(`${LOG_PREFIX} [6/7] Recording to episodic memory...`);
            try {
                await insertFileUpload(context.tenantId, {
                    filename: context.filename,
                    fileType,
                    sizeBytes: context.sizeBytes,
                    parseStatus: "completed",
                    chunkCount: chunks.length,
                    episodeId: context.episodeId || uuidv4(),
                    langsmithTraceId: traceId,
                });
                console.log(`${LOG_PREFIX} [6/7] ✓ Recorded`);
            } catch (dbErr) {
                console.warn(`${LOG_PREFIX} [6/7] ⚠ DB not available: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
            }

            // ── Step 7: Notify agent ─────────────────────────
            console.log(`${LOG_PREFIX} [7/7] Notifying agent...`);
            await notifyAgent(
                context.activeAgent,
                context.filename,
                chunks.length
            );

            const successResult: RAGPipelineResult = {
                success: true,
                filename: context.filename,
                chunkCount: chunks.length,
                chunkingStrategy: strategy,
                traceId,
                durationMs: Date.now() - startTime,
                credentialWarnings: validation.credentialWarnings,
            };
            console.log(`${LOG_PREFIX} ✅ Pipeline complete: ${chunks.length} chunks stored in ${successResult.durationMs}ms`);
            emitPipelineEvent(successResult);
            return successResult;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`${LOG_PREFIX} ❌ Pipeline failed for "${context.filename}": ${errMsg}`);
            if (error instanceof Error && error.stack) {
                console.error(`${LOG_PREFIX} Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
            }

            // Record failure to episodic memory
            try {
                await insertFileUpload(context.tenantId, {
                    filename: context.filename,
                    fileType: fileType || "unknown",
                    sizeBytes: context.sizeBytes,
                    parseStatus: "error",
                    chunkCount: 0,
                    episodeId: context.episodeId || uuidv4(),
                    langsmithTraceId: traceId,
                });
            } catch {
                // DB not available — degrade gracefully
            }

            const failResult: RAGPipelineResult = {
                success: false,
                filename: context.filename,
                chunkCount: 0,
                chunkingStrategy: null,
                traceId,
                durationMs: Date.now() - startTime,
                error: sanitizeTraceData(errMsg),
                credentialWarnings: [],
            };
            emitPipelineEvent(failResult);
            return failResult;
        }
    },
    { name: "rag.pipeline", run_type: "chain" }
);

/**
 * Fire-and-forget wrapper for the RAG pipeline.
 *
 * Starts the pipeline asynchronously — the caller does NOT wait.
 * Errors are caught and logged (not thrown).
 */
export function triggerRAGPipeline(
    context: FileUploadContext,
    onComplete?: (result: RAGPipelineResult) => void
): void {
    runRAGPipeline(context)
        .then((result) => {
            if (onComplete) onComplete(result);
        })
        .catch((error) => {
            console.error(
                `${LOG_PREFIX} Async pipeline failed for ${context.filename}:`,
                error instanceof Error ? error.message : String(error)
            );
        });
}

/** Emit pipeline result to inspector event bus for frontend visibility */
function emitPipelineEvent(result: RAGPipelineResult): void {
    try {
        inspectorBus.emitContextEvent("rag:loaded", {
            agentType: "conversation",
            chunkCount: result.chunkCount,
            sources: [result.filename],
            pipelineSuccess: result.success,
            error: result.error,
            durationMs: result.durationMs,
        });
    } catch {
        // Inspector not critical
    }
}
