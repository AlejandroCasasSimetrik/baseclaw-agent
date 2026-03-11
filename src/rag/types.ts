/**
 * Level 5 — Dynamic RAG Pipeline Types
 *
 * Central type definitions for the RAG ingestion pipeline:
 * file upload, validation, parsing, chunking, embedding, and storage.
 *
 * Multi-tenant from the start — every type includes tenantId.
 */

// ── Supported File Types ───────────────────────────────────

/** All file extensions accepted by the RAG pipeline */
export type SupportedFileType =
    // Documents
    | "pdf" | "docx" | "pptx" | "xlsx" | "txt" | "md" | "csv"
    // Web
    | "html" | "xml" | "json" | "yaml" | "yml"
    // Code
    | "js" | "ts" | "jsx" | "tsx" | "py" | "java" | "go" | "rs"
    | "rb" | "php" | "c" | "cpp" | "h" | "hpp" | "cs" | "swift"
    | "kt" | "scala" | "sh" | "bash" | "sql" | "r" | "lua"
    | "dart" | "zig" | "toml" | "ini" | "cfg"
    // Media
    | "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "svg"
    | "mp3" | "wav" | "ogg" | "flac" | "m4a"
    | "mp4" | "mov" | "avi" | "mkv" | "webm";

/** Higher-level category grouping for file types */
export type FileCategory =
    | "document"
    | "web"
    | "code"
    | "media-image"
    | "media-audio"
    | "media-video";

// ── Chunking ───────────────────────────────────────────────

/** Strategy names for routing files to the correct chunker */
export type ChunkingStrategy =
    | "page-level"
    | "recursive-text"
    | "code-aware"
    | "row-group";

/** A single chunk produced by any chunker */
export interface RAGChunk {
    /** The chunk text content */
    text: string;
    /** Full metadata attached to every chunk */
    metadata: RAGChunkMetadata;
}

/** Metadata attached to every chunk vector */
export interface RAGChunkMetadata {
    /** Original filename */
    source_file: string;
    /** Detected file type (extension) */
    file_type: string;
    /** ISO timestamp of when the file was uploaded */
    upload_timestamp: string;
    /** Which phase was active (ideation/planning/execution/review/conversation) */
    active_phase: string;
    /** Which agent was active when the file arrived */
    active_agent: string;
    /** Position within the source file (0-indexed) */
    chunk_index: string;
    /** Total chunks from this file */
    chunk_total: string;
    /** Tenant isolation key */
    tenant_id: string;
    /** Allow arbitrary additional metadata */
    [key: string]: string;
}

// ── Validation ─────────────────────────────────────────────

/** Result of file validation step */
export interface ValidationResult {
    /** Whether the file passed all validation checks */
    valid: boolean;
    /** Reason for rejection (if valid === false) */
    reason?: string;
    /** Credential patterns detected in file content */
    credentialWarnings: string[];
}

// ── Parsing ────────────────────────────────────────────────

/** Output from any parser */
export interface ParseResult {
    /** Extracted text content */
    text: string;
    /** Parser-specific metadata */
    parserMetadata: Record<string, unknown>;
    /** Which parser was used */
    parserUsed: string;
}

// ── Pipeline ───────────────────────────────────────────────

/** Context provided when a file is uploaded */
export interface FileUploadContext {
    /** Original filename */
    filename: string;
    /** Raw file content as Buffer */
    content: Buffer;
    /** File size in bytes */
    sizeBytes: number;
    /** Current active phase when file was uploaded */
    activePhase: string;
    /** Current active agent when file was uploaded */
    activeAgent: string;
    /** Tenant ID for multi-tenancy */
    tenantId: string;
    /** Optional episode ID to link file_uploads to */
    episodeId?: string;
}

/** Final result of the RAG pipeline */
export interface RAGPipelineResult {
    /** Whether the pipeline succeeded */
    success: boolean;
    /** Original filename */
    filename: string;
    /** Number of chunks generated */
    chunkCount: number;
    /** Chunking strategy used */
    chunkingStrategy: ChunkingStrategy | null;
    /** LangSmith trace ID for this pipeline run */
    traceId: string;
    /** Total pipeline duration in ms */
    durationMs: number;
    /** Validation failure reason (if rejected) */
    rejectionReason?: string;
    /** Credential warnings detected */
    credentialWarnings: string[];
    /** Error message if pipeline failed after validation */
    error?: string;
}

// ── RAG Query ──────────────────────────────────────────────

/** Filter options for queryRAG() */
export interface RAGQueryFilters {
    /** Filter by active phase */
    phase?: string;
    /** Filter by active agent */
    agent?: string;
    /** Filter by file type (extension) */
    fileType?: string;
    /** Filter by source filename */
    sourceFile?: string;
}

/** Result from a RAG query */
export interface RAGQueryResult {
    /** Vector ID */
    id: string;
    /** Similarity score */
    score: number;
    /** Chunk text content */
    content?: string;
    /** Full chunk metadata */
    metadata: RAGChunkMetadata;
}

// ── Notification ───────────────────────────────────────────

/** Notification sent to the active agent after ingestion */
export interface RAGNotification {
    /** Which agent was notified */
    agentName: string;
    /** Original filename */
    filename: string;
    /** Number of chunks stored */
    chunkCount: number;
    /** Suggested query to retrieve the new content */
    suggestedQuery: string;
    /** When the notification was sent */
    timestamp: string;
}
