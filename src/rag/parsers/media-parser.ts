/**
 * Level 5 — Media Parsers (Stubs)
 *
 * Placeholder implementations for:
 *   - Image → OCR text extraction
 *   - Audio → Speech-to-text transcription
 *   - Video → Frame extraction + description
 *
 * These return placeholder text. Swap out for real
 * implementations (Tesseract, Whisper, etc.) when ready.
 */

import { traceable } from "langsmith/traceable";
import type { ParseResult } from "../types.js";

/**
 * Parse an image file via OCR.
 * STUB — returns placeholder text.
 */
export const parseImage = traceable(
    async (
        filename: string,
        _content: Buffer,
        fileType: string
    ): Promise<ParseResult> => {
        return {
            text: `[OCR: ${filename}] — Image content extraction is a stub. Replace with Tesseract or a vision model for real OCR.`,
            parserMetadata: {
                parser: "ocr-stub",
                fileType,
                stub: true,
            },
            parserUsed: "ocr-stub",
        };
    },
    { name: "rag.parse.image", run_type: "chain" }
);

/**
 * Parse an audio file via speech-to-text.
 * STUB — returns placeholder text.
 */
export const parseAudio = traceable(
    async (
        filename: string,
        _content: Buffer,
        fileType: string
    ): Promise<ParseResult> => {
        return {
            text: `[Transcription: ${filename}] — Audio transcription is a stub. Replace with Whisper or Deepgram for real STT.`,
            parserMetadata: {
                parser: "stt-stub",
                fileType,
                stub: true,
            },
            parserUsed: "stt-stub",
        };
    },
    { name: "rag.parse.audio", run_type: "chain" }
);

/**
 * Parse a video file via frame extraction.
 * STUB — returns placeholder text.
 */
export const parseVideo = traceable(
    async (
        filename: string,
        _content: Buffer,
        fileType: string
    ): Promise<ParseResult> => {
        return {
            text: `[Video: ${filename}] — Video frame extraction is a stub. Implement frame sampling and description when ready.`,
            parserMetadata: {
                parser: "video-stub",
                fileType,
                stub: true,
            },
            parserUsed: "video-stub",
        };
    },
    { name: "rag.parse.video", run_type: "chain" }
);
