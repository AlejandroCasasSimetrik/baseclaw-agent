/**
 * Level 5 — Parser Router
 *
 * Selects the right parser based on file category:
 *   - document → LlamaParse
 *   - web → text reader with cleanup
 *   - code → text reader with language detection
 *   - media-image → OCR stub
 *   - media-audio → STT stub
 *   - media-video → frame extraction stub
 *
 * All parsing traced as a LangSmith span.
 */

import { traceable } from "langsmith/traceable";
import { getFileCategory, getFileExtension } from "../config.js";
import { parseDocument } from "./llamaparse.js";
import { parseCodeFile } from "./code-parser.js";
import { parseImage, parseAudio, parseVideo } from "./media-parser.js";
import type { ParseResult } from "../types.js";

/**
 * Parse a web file (HTML, JSON, YAML, XML).
 * Simple text extraction — strips nothing, preserves structure.
 */
export const parseWebFile = traceable(
    async (
        filename: string,
        content: Buffer,
        fileType: string
    ): Promise<ParseResult> => {
        const text = content.toString("utf-8");
        return {
            text,
            parserMetadata: {
                parser: "web-reader",
                fileType,
                charCount: text.length,
            },
            parserUsed: "web-reader",
        };
    },
    { name: "rag.parse.web", run_type: "chain" }
);

/**
 * Route a file to the correct parser based on its category.
 *
 * Traced as the parent parse span with parser selection metadata.
 */
export const parseFile = traceable(
    async (
        filename: string,
        content: Buffer
    ): Promise<ParseResult> => {
        const extension = getFileExtension(filename);
        const category = getFileCategory(extension);

        if (!category) {
            throw new Error(`No parser available for file type: .${extension}`);
        }

        switch (category) {
            case "document":
                return parseDocument(filename, content, extension);
            case "web":
                return parseWebFile(filename, content, extension);
            case "code":
                return parseCodeFile(filename, content, extension);
            case "media-image":
                return parseImage(filename, content, extension);
            case "media-audio":
                return parseAudio(filename, content, extension);
            case "media-video":
                return parseVideo(filename, content, extension);
            default:
                throw new Error(`Unknown file category: ${category}`);
        }
    },
    { name: "rag.parse", run_type: "chain" }
);
