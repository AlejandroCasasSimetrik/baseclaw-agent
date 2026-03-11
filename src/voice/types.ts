/**
 * Level 7 — Voice I/O Types
 *
 * Central type definitions for STT, TTS, voice configuration,
 * and audio metadata. Used across all voice sub-modules.
 */

// ── Audio Formats ──────────────────────────────────────────

export const SUPPORTED_AUDIO_FORMATS = [
    "wav",
    "mp3",
    "m4a",
    "ogg",
    "webm",
    "mpeg",
    "mp4",
    "mpga",
] as const;

export type AudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];

// ── Configuration Defaults ─────────────────────────────────

/** Default max audio duration: 5 minutes (300 seconds) */
export const DEFAULT_MAX_AUDIO_DURATION_SECONDS = 300;

/** Default max audio file size: 25 MB */
export const DEFAULT_MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;

/** Default STT provider */
export const DEFAULT_STT_PROVIDER: STTProviderName = "whisper";

/** Default TTS model */
export const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";

/** Default TTS enabled state */
export const DEFAULT_TTS_ENABLED = true;

// ── STT Types ──────────────────────────────────────────────

export type STTProviderName = "whisper" | "deepgram";

/** Incoming audio for STT transcription */
export interface AudioInput {
    /** Raw audio data */
    buffer: Buffer;
    /** Audio format / file extension */
    format: AudioFormat;
    /** Duration in milliseconds (if known) */
    durationMs?: number;
    /** File size in bytes */
    sizeBytes: number;
    /** Original filename (if available) */
    filename?: string;
}

/** Result from STT transcription */
export interface STTResult {
    /** Transcribed text */
    text: string;
    /** Confidence score 0–1 (null if provider doesn't support it) */
    confidence: number | null;
    /** Which provider produced this result */
    provider: STTProviderName;
    /** Transcription latency in milliseconds */
    latencyMs: number;
    /** Whether transcription succeeded */
    success: boolean;
    /** Error message if failed */
    errorMessage?: string;
}

/** Interface that all STT providers must implement */
export interface STTProvider {
    /** Provider name identifier */
    readonly name: STTProviderName;
    /** Transcribe audio to text */
    transcribe(audio: AudioInput): Promise<STTResult>;
}

// ── TTS Types ──────────────────────────────────────────────

/** Result from TTS synthesis */
export interface TTSResult {
    /** Synthesized audio data (null on failure) */
    audioBuffer: Buffer | null;
    /** Audio format of the output */
    format: "mp3";
    /** Duration of synthesized audio in ms (estimated) */
    durationMs: number | null;
    /** Synthesis latency in milliseconds */
    latencyMs: number;
    /** Voice ID used */
    voiceId: string;
    /** Model ID used */
    modelId: string;
    /** Whether streaming was used */
    streamingUsed: boolean;
    /** Whether synthesis succeeded */
    success: boolean;
    /** Error message if failed */
    errorMessage?: string;
}

/** Interface for TTS providers */
export interface TTSProvider {
    /** Synthesize text to speech */
    synthesize(text: string, voiceId: string, modelId: string): Promise<TTSResult>;
    /** List available voices */
    listVoices(): Promise<VoiceInfo[]>;
}

/** Voice info from provider */
export interface VoiceInfo {
    voiceId: string;
    name: string;
    category?: string;
    description?: string;
}

// ── Voice Configuration ────────────────────────────────────

/** Per-tenant voice configuration */
export interface VoiceConfig {
    /** Tenant isolation key */
    tenantId: string;
    /** Active STT provider */
    sttProvider: STTProviderName;
    /** Whether TTS is enabled */
    ttsEnabled: boolean;
    /** ElevenLabs voice ID */
    voiceId: string;
    /** ElevenLabs model ID */
    modelId: string;
    /** Max audio duration in seconds */
    maxAudioDurationSeconds: number;
    /** Max audio file size in bytes */
    maxAudioSizeBytes: number;
}

/** Partial config for updates */
export type VoiceConfigUpdate = Partial<Omit<VoiceConfig, "tenantId">>;

// ── Voice Input State (for BaseClawState) ──────────────────

/** Voice input metadata attached to state after STT processing */
export interface VoiceInputState {
    /** Original audio format */
    audioFormat: AudioFormat;
    /** Audio duration in ms */
    durationMs: number;
    /** Audio file size in bytes */
    sizeBytes: number;
    /** Transcribed text */
    transcribedText: string;
    /** STT provider used */
    sttProvider: STTProviderName;
    /** Confidence score (null if unavailable) */
    confidence: number | null;
}

// ── Validation Types ───────────────────────────────────────

export interface AudioValidationResult {
    /** Whether the audio passed all validation checks */
    valid: boolean;
    /** Human-readable error message (null if valid) */
    errorMessage: string | null;
    /** Specific validation failure code */
    errorCode:
    | null
    | "FORMAT_UNSUPPORTED"
    | "SIZE_EXCEEDED"
    | "DURATION_EXCEEDED"
    | "EMPTY_AUDIO"
    | "SILENT_AUDIO";
}

// ── Type Guards ────────────────────────────────────────────

export function isValidAudioFormat(format: string): format is AudioFormat {
    return SUPPORTED_AUDIO_FORMATS.includes(format as AudioFormat);
}

export function isValidSTTProvider(
    provider: string
): provider is STTProviderName {
    return provider === "whisper" || provider === "deepgram";
}

export function isValidVoiceConfig(config: unknown): config is VoiceConfig {
    if (!config || typeof config !== "object") return false;
    const c = config as Record<string, unknown>;
    return (
        typeof c.tenantId === "string" &&
        typeof c.sttProvider === "string" &&
        isValidSTTProvider(c.sttProvider) &&
        typeof c.ttsEnabled === "boolean" &&
        typeof c.voiceId === "string" &&
        typeof c.modelId === "string" &&
        typeof c.maxAudioDurationSeconds === "number" &&
        typeof c.maxAudioSizeBytes === "number"
    );
}
