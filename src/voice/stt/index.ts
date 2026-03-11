/**
 * Level 7 — STT Module
 *
 * Factory function for creating the configured STT provider.
 * Provider selection is config-driven, not hardcoded.
 */

import type { STTProvider, STTProviderName } from "./types.js";
import { WhisperSTTProvider } from "./whisper.js";
import { DeepgramSTTProvider } from "./deepgram.js";

export { WhisperSTTProvider } from "./whisper.js";
export { DeepgramSTTProvider } from "./deepgram.js";
export type { STTProvider, STTResult, AudioInput, STTProviderName } from "./types.js";

/**
 * Create an STT provider based on the configured provider name.
 *
 * @param providerName - "whisper" or "deepgram"
 * @returns The corresponding STT provider instance
 */
export function createSTTProvider(
    providerName?: STTProviderName
): STTProvider {
    const name =
        providerName ??
        (process.env.STT_PROVIDER as STTProviderName) ??
        "whisper";

    switch (name) {
        case "deepgram":
            return new DeepgramSTTProvider();
        case "whisper":
        default:
            return new WhisperSTTProvider();
    }
}
