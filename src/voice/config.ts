/**
 * Level 7 — Voice Configuration Management
 *
 * Per-tenant voice settings with PostgreSQL persistence.
 * Falls back to environment variable defaults when no tenant config exists.
 */

import type {
    VoiceConfig,
    VoiceConfigUpdate,
    VoiceInfo,
    STTProviderName,
} from "./types.js";
import {
    DEFAULT_STT_PROVIDER,
    DEFAULT_TTS_ENABLED,
    DEFAULT_TTS_MODEL,
    DEFAULT_MAX_AUDIO_DURATION_SECONDS,
    DEFAULT_MAX_AUDIO_SIZE_BYTES,
    isValidSTTProvider,
} from "./types.js";
import { ElevenLabsTTSProvider } from "./tts/elevenlabs.js";

// ── In-memory config store (backed by DB when available) ────

const configCache = new Map<string, VoiceConfig>();

/**
 * Build default voice config from environment variables.
 */
export function getDefaultVoiceConfig(tenantId: string): VoiceConfig {
    const sttProvider = process.env.STT_PROVIDER ?? DEFAULT_STT_PROVIDER;

    return {
        tenantId,
        sttProvider: isValidSTTProvider(sttProvider)
            ? sttProvider
            : DEFAULT_STT_PROVIDER,
        ttsEnabled:
            process.env.TTS_ENABLED !== undefined
                ? process.env.TTS_ENABLED === "true"
                : DEFAULT_TTS_ENABLED,
        voiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
        modelId: process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_TTS_MODEL,
        maxAudioDurationSeconds: parseInt(
            process.env.VOICE_MAX_AUDIO_DURATION_SECONDS ?? "",
            10
        ) || DEFAULT_MAX_AUDIO_DURATION_SECONDS,
        maxAudioSizeBytes: parseInt(
            process.env.VOICE_MAX_AUDIO_SIZE_BYTES ?? "",
            10
        ) || DEFAULT_MAX_AUDIO_SIZE_BYTES,
    };
}

/**
 * Get voice configuration for a tenant.
 * Returns cached config, falls back to DB, then to env defaults.
 */
export async function getVoiceConfig(
    tenantId: string
): Promise<VoiceConfig> {
    // Check cache first
    const cached = configCache.get(tenantId);
    if (cached) return cached;

    // Try loading from DB
    try {
        const dbConfig = await loadConfigFromDb(tenantId);
        if (dbConfig) {
            configCache.set(tenantId, dbConfig);
            return dbConfig;
        }
    } catch {
        // DB not available — fall back to defaults
    }

    // Return defaults from env
    const defaults = getDefaultVoiceConfig(tenantId);
    configCache.set(tenantId, defaults);
    return defaults;
}

/**
 * Update voice configuration for a tenant at runtime.
 * Persists to DB and updates cache.
 */
export async function updateVoiceConfig(
    tenantId: string,
    updates: VoiceConfigUpdate
): Promise<VoiceConfig> {
    const current = await getVoiceConfig(tenantId);
    const updated: VoiceConfig = {
        ...current,
        ...updates,
        tenantId, // Never allow tenantId to be overwritten
    };

    // Validate STT provider
    if (
        updates.sttProvider &&
        !isValidSTTProvider(updates.sttProvider)
    ) {
        throw new Error(
            `Invalid STT provider: "${updates.sttProvider}". Must be "whisper" or "deepgram".`
        );
    }

    // Persist to DB
    try {
        await saveConfigToDb(updated);
    } catch {
        // DB not available — config is still in memory/cache
    }

    configCache.set(tenantId, updated);
    return updated;
}

/**
 * List available ElevenLabs voices.
 */
export async function getSupportedVoices(): Promise<VoiceInfo[]> {
    const provider = new ElevenLabsTTSProvider();
    return provider.listVoices();
}

/**
 * Change the active voice for a tenant.
 */
export async function setVoice(
    tenantId: string,
    voiceId: string
): Promise<void> {
    await updateVoiceConfig(tenantId, { voiceId });
}

/**
 * Clear the config cache (useful for tests).
 */
export function clearConfigCache(): void {
    configCache.clear();
}

// ── DB Persistence Helpers ─────────────────────────────────

/**
 * Load voice config from PostgreSQL.
 * Returns null if no config exists for this tenant.
 */
async function loadConfigFromDb(
    tenantId: string
): Promise<VoiceConfig | null> {
    try {
        const { getDb } = await import("../memory/episodic/db.js");
        const { voiceConfig } = await import(
            "../memory/episodic/schema.js"
        );
        const { eq } = await import("drizzle-orm");

        const db = getDb();
        const results = await db
            .select()
            .from(voiceConfig)
            .where(eq(voiceConfig.tenantId, tenantId))
            .limit(1);

        if (results.length === 0) return null;

        const row = results[0];
        return {
            tenantId: row.tenantId,
            sttProvider: (row.sttProvider as STTProviderName) ??
                DEFAULT_STT_PROVIDER,
            ttsEnabled: row.ttsEnabled === "true",
            voiceId: row.voiceId ?? "",
            modelId: row.modelId ?? DEFAULT_TTS_MODEL,
            maxAudioDurationSeconds:
                row.maxAudioDurationSeconds ??
                DEFAULT_MAX_AUDIO_DURATION_SECONDS,
            maxAudioSizeBytes:
                row.maxAudioSizeBytes ?? DEFAULT_MAX_AUDIO_SIZE_BYTES,
        };
    } catch {
        return null;
    }
}

/**
 * Save voice config to PostgreSQL (upsert).
 */
async function saveConfigToDb(config: VoiceConfig): Promise<void> {
    try {
        const { getDb } = await import("../memory/episodic/db.js");
        const { voiceConfig } = await import(
            "../memory/episodic/schema.js"
        );

        const db = getDb();
        await db
            .insert(voiceConfig)
            .values({
                tenantId: config.tenantId,
                sttProvider: config.sttProvider,
                ttsEnabled: String(config.ttsEnabled),
                voiceId: config.voiceId,
                modelId: config.modelId,
                maxAudioDurationSeconds: config.maxAudioDurationSeconds,
                maxAudioSizeBytes: config.maxAudioSizeBytes,
            })
            .onConflictDoUpdate({
                target: voiceConfig.tenantId,
                set: {
                    sttProvider: config.sttProvider,
                    ttsEnabled: String(config.ttsEnabled),
                    voiceId: config.voiceId,
                    modelId: config.modelId,
                    maxAudioDurationSeconds:
                        config.maxAudioDurationSeconds,
                    maxAudioSizeBytes: config.maxAudioSizeBytes,
                },
            });
    } catch {
        // DB not available — swallowed; config remains in cache
    }
}
