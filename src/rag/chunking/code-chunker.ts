/**
 * Level 5 — Code-Aware Chunker
 *
 * Language-aware splitting that preserves function/class boundaries.
 * Uses configurable delimiter patterns to split code at logical
 * boundaries rather than arbitrary character positions.
 */

import type { RAGChunk, RAGChunkMetadata } from "../types.js";

/**
 * Language-specific patterns for splitting at logical boundaries.
 * These are tried in order — first match wins.
 */
const CODE_BOUNDARY_PATTERNS: Record<string, RegExp[]> = {
    // JavaScript/TypeScript — split at function, class, export boundaries
    javascript: [
        /(?=\n(?:export\s+)?(?:async\s+)?function\s+)/g,
        /(?=\n(?:export\s+)?class\s+)/g,
        /(?=\n(?:export\s+)?(?:const|let|var)\s+\w+\s*=)/g,
    ],
    typescript: [
        /(?=\n(?:export\s+)?(?:async\s+)?function\s+)/g,
        /(?=\n(?:export\s+)?class\s+)/g,
        /(?=\n(?:export\s+)?(?:interface|type)\s+)/g,
        /(?=\n(?:export\s+)?(?:const|let|var)\s+\w+\s*=)/g,
    ],
    // Python — split at def, class boundaries
    python: [
        /(?=\nclass\s+)/g,
        /(?=\ndef\s+)/g,
        /(?=\nasync\s+def\s+)/g,
    ],
    // Java/Kotlin — split at class, method boundaries
    java: [
        /(?=\n\s*(?:public|private|protected)\s+class\s+)/g,
        /(?=\n\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>[\],\s]+\s+\w+\s*\()/g,
    ],
    kotlin: [
        /(?=\n(?:class|object|interface)\s+)/g,
        /(?=\n\s*(?:fun|suspend\s+fun)\s+)/g,
    ],
    // Go — split at func, type boundaries
    go: [
        /(?=\nfunc\s+)/g,
        /(?=\ntype\s+)/g,
    ],
    // Rust — split at fn, struct, impl boundaries
    rust: [
        /(?=\n(?:pub\s+)?fn\s+)/g,
        /(?=\n(?:pub\s+)?struct\s+)/g,
        /(?=\nimpl\s+)/g,
    ],
};

/**
 * Default boundary: split on double-newline (paragraph) or function-like patterns.
 */
const DEFAULT_BOUNDARY = /(?=\n\n)/g;

/**
 * Split code into chunks preserving function/class boundaries.
 *
 * Strategy:
 * 1. Try to split at language-specific boundaries
 * 2. Fall back to double-newline paragraph splitting
 * 3. If still too large, hard-split at character limit
 */
export function chunkCode(
    text: string,
    baseMetadata: Omit<RAGChunkMetadata, "chunk_index" | "chunk_total">,
    language: string = "unknown",
    maxChunkSize: number = 2000
): RAGChunk[] {
    const patterns = CODE_BOUNDARY_PATTERNS[language] ?? [];

    let sections: string[] = [text];

    // Try language-specific patterns
    for (const pattern of patterns) {
        const newSections: string[] = [];
        for (const section of sections) {
            if (section.length > maxChunkSize) {
                pattern.lastIndex = 0;
                const parts = section.split(pattern).filter((p) => p.trim().length > 0);
                newSections.push(...parts);
            } else {
                newSections.push(section);
            }
        }
        sections = newSections;
    }

    // Fall back: split remaining large sections on double-newline
    const fallbackSections: string[] = [];
    for (const section of sections) {
        if (section.length > maxChunkSize) {
            const parts = section.split(DEFAULT_BOUNDARY).filter((p) => p.trim().length > 0);
            fallbackSections.push(...parts);
        } else {
            fallbackSections.push(section);
        }
    }
    sections = fallbackSections;

    // Last resort: hard split remaining oversized sections
    const finalSections: string[] = [];
    for (const section of sections) {
        if (section.length > maxChunkSize * 2) {
            for (let i = 0; i < section.length; i += maxChunkSize) {
                finalSections.push(section.slice(i, i + maxChunkSize));
            }
        } else {
            finalSections.push(section);
        }
    }

    // Filter empty chunks
    const chunks = finalSections.filter((s) => s.trim().length > 0);
    const totalChunks = chunks.length;

    return chunks.map((chunkText, index) => ({
        text: chunkText.trim(),
        metadata: {
            ...baseMetadata,
            chunk_index: String(index),
            chunk_total: String(totalChunks),
        } as RAGChunkMetadata,
    }));
}
