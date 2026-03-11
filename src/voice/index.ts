/**
 * Level 7 — Voice I/O Module
 *
 * Barrel export for the entire voice subsystem.
 * Provides STT, TTS, validation, configuration, and types.
 */

// ── Types ──────────────────────────────────────────────────
export type {
    AudioInput,
    AudioFormat,
    STTResult,
    STTProvider,
    STTProviderName,
    TTSResult,
    TTSProvider,
    VoiceInfo,
    VoiceConfig,
    VoiceConfigUpdate,
    VoiceInputState,
    AudioValidationResult,
} from "./types.js";

export {
    SUPPORTED_AUDIO_FORMATS,
    DEFAULT_MAX_AUDIO_DURATION_SECONDS,
    DEFAULT_MAX_AUDIO_SIZE_BYTES,
    DEFAULT_STT_PROVIDER,
    DEFAULT_TTS_MODEL,
    DEFAULT_TTS_ENABLED,
    isValidAudioFormat,
    isValidSTTProvider,
    isValidVoiceConfig,
} from "./types.js";

// ── Validation ─────────────────────────────────────────────
export {
    validateAudioInput,
    isAudioSilent,
    isSupportedFormat,
    extractAudioFormat,
} from "./validation.js";

// ── STT ────────────────────────────────────────────────────
export {
    createSTTProvider,
    WhisperSTTProvider,
    DeepgramSTTProvider,
} from "./stt/index.js";

// ── TTS ────────────────────────────────────────────────────
export { ElevenLabsTTSProvider } from "./tts/index.js";

// ── Configuration ──────────────────────────────────────────
export {
    getVoiceConfig,
    updateVoiceConfig,
    getSupportedVoices,
    setVoice,
    getDefaultVoiceConfig,
    clearConfigCache,
} from "./config.js";
