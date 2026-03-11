/**
 * Level 7 — Audio Validation
 *
 * Validates incoming audio before STT processing.
 * Enforces format, size, and duration limits.
 * Detects empty/silent audio.
 */

import type { AudioInput, AudioValidationResult, VoiceConfig } from "./types.js";
import {
    isValidAudioFormat,
    DEFAULT_MAX_AUDIO_DURATION_SECONDS,
    DEFAULT_MAX_AUDIO_SIZE_BYTES,
} from "./types.js";

/**
 * Validate an audio input against configured limits.
 *
 * Checks are performed in this order:
 * 1. Format support
 * 2. Empty audio (zero-length buffer)
 * 3. File size limit
 * 4. Duration limit
 * 5. Silence detection
 */
export function validateAudioInput(
    input: AudioInput,
    config?: Partial<VoiceConfig>
): AudioValidationResult {
    const maxSizeBytes =
        config?.maxAudioSizeBytes ?? DEFAULT_MAX_AUDIO_SIZE_BYTES;
    const maxDurationSeconds =
        config?.maxAudioDurationSeconds ?? DEFAULT_MAX_AUDIO_DURATION_SECONDS;

    // 1. Format check
    if (!isValidAudioFormat(input.format)) {
        return {
            valid: false,
            errorMessage: `Unsupported audio format: "${input.format}". Supported formats: wav, mp3, m4a, ogg, webm, mpeg, mp4, mpga.`,
            errorCode: "FORMAT_UNSUPPORTED",
        };
    }

    // 2. Empty audio
    if (!input.buffer || input.buffer.length === 0) {
        return {
            valid: false,
            errorMessage:
                "The audio file appears to be empty. Please try recording again.",
            errorCode: "EMPTY_AUDIO",
        };
    }

    // 3. Size limit
    if (input.sizeBytes > maxSizeBytes) {
        const maxMB = Math.round(maxSizeBytes / (1024 * 1024));
        const actualMB = (input.sizeBytes / (1024 * 1024)).toFixed(1);
        return {
            valid: false,
            errorMessage: `Audio file is too large (${actualMB} MB). Maximum allowed size is ${maxMB} MB.`,
            errorCode: "SIZE_EXCEEDED",
        };
    }

    // 4. Duration limit
    if (input.durationMs !== undefined) {
        const maxDurationMs = maxDurationSeconds * 1000;
        if (input.durationMs > maxDurationMs) {
            const maxMin = Math.round(maxDurationSeconds / 60);
            const actualMin = (input.durationMs / 60000).toFixed(1);
            return {
                valid: false,
                errorMessage: `Audio is too long (${actualMin} minutes). Maximum allowed duration is ${maxMin} minutes.`,
                errorCode: "DURATION_EXCEEDED",
            };
        }
    }

    // 5. Silence detection (heuristic: very small buffer for claimed duration)
    if (isAudioSilent(input)) {
        return {
            valid: false,
            errorMessage:
                "The audio appears to be silent or contains no speech. Please try again.",
            errorCode: "SILENT_AUDIO",
        };
    }

    return {
        valid: true,
        errorMessage: null,
        errorCode: null,
    };
}

/**
 * Heuristic silence detection.
 *
 * Checks if the audio buffer is suspiciously small relative to its
 * declared duration, or if the buffer contains predominantly zero bytes.
 */
export function isAudioSilent(input: AudioInput): boolean {
    if (!input.buffer || input.buffer.length === 0) return true;

    // If we have duration info, check if buffer is implausibly small
    // (a 1-second WAV at 16kHz mono 16-bit ≈ 32KB, MP3 ≈ 16KB)
    if (input.durationMs && input.durationMs > 1000) {
        const minBytesPerSecond = 1000; // Very conservative minimum
        const expectedMinBytes =
            (input.durationMs / 1000) * minBytesPerSecond;
        if (input.buffer.length < expectedMinBytes) return true;
    }

    // Sample-based silence check: sample up to 1000 bytes
    const sampleSize = Math.min(input.buffer.length, 1000);
    let zeroCount = 0;
    for (let i = 0; i < sampleSize; i++) {
        if (input.buffer[i] === 0) zeroCount++;
    }
    // If 95%+ of sampled bytes are zero, consider it silent
    const zeroRatio = zeroCount / sampleSize;
    return zeroRatio > 0.95;
}

/**
 * Check if a format string is supported.
 */
export function isSupportedFormat(format: string): boolean {
    return isValidAudioFormat(format);
}

/**
 * Extract format from a filename or MIME type.
 */
export function extractAudioFormat(
    filenameOrMime: string
): string | null {
    // From filename: "recording.mp3" → "mp3"
    const extMatch = filenameOrMime.match(/\.(\w+)$/);
    if (extMatch) return extMatch[1].toLowerCase();

    // From MIME: "audio/wav" → "wav"
    const mimeMatch = filenameOrMime.match(/^audio\/(\w+)/);
    if (mimeMatch) return mimeMatch[1].toLowerCase();

    return null;
}
