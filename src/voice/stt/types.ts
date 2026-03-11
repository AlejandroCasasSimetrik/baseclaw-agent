/**
 * Level 7 — STT Provider Types
 *
 * Re-exports the STT-related types from the central voice types module.
 * Keeps the STT sub-module self-contained for provider implementations.
 */

export type {
    STTProvider,
    STTResult,
    AudioInput,
    STTProviderName,
} from "../types.js";
