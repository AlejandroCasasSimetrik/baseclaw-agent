/**
 * Level 5 — Dynamic RAG Pipeline
 *
 * Barrel export for the entire RAG module.
 */

// ── Pipeline ───────────────────────────────────────────────
export { runRAGPipeline, triggerRAGPipeline } from "./pipeline.js";

// ── Validation ─────────────────────────────────────────────
export { validateFile, scanForCredentials } from "./validation.js";

// ── Parsing ────────────────────────────────────────────────
export { parseFile, parseWebFile } from "./parsers/index.js";
export { parseDocument } from "./parsers/llamaparse.js";
export { parseCodeFile, detectLanguage } from "./parsers/code-parser.js";
export { parseImage, parseAudio, parseVideo } from "./parsers/media-parser.js";

// ── Chunking ───────────────────────────────────────────────
export {
    chunkContent,
    chunkByPage,
    chunkRecursive,
    chunkCode,
    chunkByRows,
} from "./chunking/index.js";

// ── Embedding ──────────────────────────────────────────────
export { embedChunks, getEmbeddingModelName } from "./embedding.js";
export type { ChunkEmbedding } from "./embedding.js";

// ── Storage ────────────────────────────────────────────────
export { storeChunks } from "./storage.js";

// ── Notification ───────────────────────────────────────────
export { notifyAgent } from "./notification.js";

// ── Config ─────────────────────────────────────────────────
export {
    MAX_FILE_SIZE_BYTES,
    ALLOWED_FILE_TYPES,
    EMBEDDING_MODEL,
    EMBEDDING_BATCH_SIZE,
    getFileCategory,
    isFileTypeAllowed,
    getChunkingStrategy,
    getFileExtension,
} from "./config.js";

// ── Types ──────────────────────────────────────────────────
export type {
    SupportedFileType,
    FileCategory,
    ChunkingStrategy,
    RAGChunk,
    RAGChunkMetadata,
    ValidationResult,
    ParseResult,
    FileUploadContext,
    RAGPipelineResult,
    RAGQueryFilters,
    RAGQueryResult,
    RAGNotification,
} from "./types.js";
