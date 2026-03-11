/**
 * Level 5 — RAG Pipeline Configuration
 *
 * Centralized, environment-overridable configuration for the
 * Dynamic RAG Pipeline. All limits, models, and allowlists
 * are defined here.
 *
 * Secrets in .env only — never in code.
 */

import type { SupportedFileType, FileCategory, ChunkingStrategy } from "./types.js";

// ── File Size ──────────────────────────────────────────────

/** Default 50MB. Override via RAG_MAX_FILE_SIZE env var (bytes). */
export const MAX_FILE_SIZE_BYTES: number =
    parseInt(process.env.RAG_MAX_FILE_SIZE ?? "", 10) || 50 * 1024 * 1024;

// ── Allowed File Types ─────────────────────────────────────

/** Maps every allowed extension to its category. */
export const ALLOWED_FILE_TYPES: Record<SupportedFileType, FileCategory> = {
    // Documents
    pdf: "document",
    docx: "document",
    pptx: "document",
    xlsx: "document",
    txt: "document",
    md: "document",
    csv: "document",
    // Web
    html: "web",
    xml: "web",
    json: "web",
    yaml: "web",
    yml: "web",
    // Code
    js: "code",
    ts: "code",
    jsx: "code",
    tsx: "code",
    py: "code",
    java: "code",
    go: "code",
    rs: "code",
    rb: "code",
    php: "code",
    c: "code",
    cpp: "code",
    h: "code",
    hpp: "code",
    cs: "code",
    swift: "code",
    kt: "code",
    scala: "code",
    sh: "code",
    bash: "code",
    sql: "code",
    r: "code",
    lua: "code",
    dart: "code",
    zig: "code",
    toml: "code",
    ini: "code",
    cfg: "code",
    // Media — Images
    png: "media-image",
    jpg: "media-image",
    jpeg: "media-image",
    gif: "media-image",
    bmp: "media-image",
    webp: "media-image",
    svg: "media-image",
    // Media — Audio
    mp3: "media-audio",
    wav: "media-audio",
    ogg: "media-audio",
    flac: "media-audio",
    m4a: "media-audio",
    // Media — Video
    mp4: "media-video",
    mov: "media-video",
    avi: "media-video",
    mkv: "media-video",
    webm: "media-video",
};

// ── Category → Chunking Strategy ───────────────────────────

/** Routes file categories to their chunking strategy. */
export const CATEGORY_CHUNKING_MAP: Record<FileCategory, ChunkingStrategy | null> = {
    document: "recursive-text",   // default for most docs
    web: "recursive-text",
    code: "code-aware",
    "media-image": null,          // single chunk (OCR output)
    "media-audio": null,          // single chunk (transcript)
    "media-video": null,          // single chunk (frame description)
};

/**
 * PDF gets special treatment — page-level chunking.
 * This overrides the category default for `document`.
 */
export const PDF_CHUNKING_STRATEGY: ChunkingStrategy = "page-level";

/**
 * Spreadsheet files get row-group chunking.
 */
export const SPREADSHEET_EXTENSIONS = new Set<string>(["xlsx", "csv"]);
export const SPREADSHEET_CHUNKING_STRATEGY: ChunkingStrategy = "row-group";

// ── Chunking Parameters ────────────────────────────────────

/** Recursive text chunking parameters */
export const RECURSIVE_CHUNK_CONFIG = {
    /** Target chunk size in characters (~400-512 tokens ≈ 1600-2048 chars) */
    targetSize: 1800,
    /** Overlap as fraction of target size (10-20%) */
    overlapFraction: 0.15,
    /** Separator priority (try first separator, fall back to next) */
    separators: ["\n\n", "\n", ". ", " "],
};

/** Row-group chunking parameters */
export const ROW_GROUP_CONFIG = {
    /** Number of data rows per chunk */
    rowsPerChunk: 50,
};

// ── Embedding ──────────────────────────────────────────────

/** Embedding model. Override via RAG_EMBEDDING_MODEL env var. */
export const EMBEDDING_MODEL: string =
    process.env.RAG_EMBEDDING_MODEL ?? "text-embedding-3-small";

/** Batch size for embedding calls. Override via RAG_EMBEDDING_BATCH_SIZE. */
export const EMBEDDING_BATCH_SIZE: number =
    parseInt(process.env.RAG_EMBEDDING_BATCH_SIZE ?? "", 10) || 100;

// ── LlamaParse ─────────────────────────────────────────────

/** LlamaParse API key — from environment only. */
export function getLlamaParseApiKey(): string | undefined {
    return process.env.LLAMAPARSE_API_KEY;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Get the file category for a given extension.
 * Returns undefined for unsupported types.
 */
export function getFileCategory(extension: string): FileCategory | undefined {
    const ext = extension.toLowerCase().replace(/^\./, "") as SupportedFileType;
    return ALLOWED_FILE_TYPES[ext];
}

/**
 * Check if a file extension is supported.
 */
export function isFileTypeAllowed(extension: string): boolean {
    const ext = extension.toLowerCase().replace(/^\./, "") as SupportedFileType;
    return ext in ALLOWED_FILE_TYPES;
}

/**
 * Get the chunking strategy for a given file extension.
 */
export function getChunkingStrategy(extension: string): ChunkingStrategy | null {
    const ext = extension.toLowerCase().replace(/^\./, "");

    // PDF always uses page-level
    if (ext === "pdf") return PDF_CHUNKING_STRATEGY;

    // Spreadsheets use row-group
    if (SPREADSHEET_EXTENSIONS.has(ext)) return SPREADSHEET_CHUNKING_STRATEGY;

    // Everything else by category
    const category = getFileCategory(ext);
    if (!category) return null;

    return CATEGORY_CHUNKING_MAP[category];
}

/**
 * Extract file extension from a filename.
 */
export function getFileExtension(filename: string): string {
    const parts = filename.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}
