/**
 * Level 7 — ElevenLabs TTS Provider
 *
 * Text-to-Speech synthesis using ElevenLabs API.
 * Supports streaming, long text chunking, and voice listing.
 *
 * Design principles:
 * - TTS failure never blocks the text response
 * - Audio is streamed/delivered, not stored permanently
 * - API key comes from .env only
 */

import type { TTSProvider, TTSResult, VoiceInfo } from "./types.js";
import {
    DEFAULT_TTS_MODEL,
} from "../types.js";

/** Maximum characters per TTS chunk to avoid API limits */
const MAX_CHUNK_LENGTH = 5000;

/**
 * ElevenLabs Text-to-Speech provider.
 */
export class ElevenLabsTTSProvider implements TTSProvider {
    private apiKey: string;

    constructor(apiKey?: string) {
        this.apiKey = apiKey ?? process.env.ELEVENLABS_API_KEY ?? "";
    }

    /**
     * Synthesize text to speech.
     * For long texts, chunks into paragraphs and synthesizes incrementally.
     */
    async synthesize(
        text: string,
        voiceId: string,
        modelId?: string
    ): Promise<TTSResult> {
        const startTime = Date.now();
        const model = modelId ?? DEFAULT_TTS_MODEL;

        try {
            if (!this.apiKey) {
                throw new Error("ELEVENLABS_API_KEY is not configured");
            }

            // Chunk long text by paragraphs
            const chunks = this.chunkText(text);
            const audioChunks: Buffer[] = [];
            let streamingUsed = false;

            for (const chunk of chunks) {
                const response = await fetch(
                    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "xi-api-key": this.apiKey,
                        },
                        body: JSON.stringify({
                            text: chunk,
                            model_id: model,
                            voice_settings: {
                                stability: 0.5,
                                similarity_boost: 0.75,
                            },
                        }),
                    }
                );

                if (!response.ok) {
                    const errorBody = await response.text().catch(() => "");
                    throw new Error(
                        `ElevenLabs API error ${response.status}: ${errorBody}`
                    );
                }

                const arrayBuffer = await response.arrayBuffer();
                audioChunks.push(Buffer.from(arrayBuffer));

                // If we're processing multiple chunks, we're doing incremental synthesis
                if (chunks.length > 1) streamingUsed = true;
            }

            const audioBuffer = Buffer.concat(audioChunks);
            const latencyMs = Date.now() - startTime;

            // Rough duration estimate: MP3 at 128kbps
            const estimatedDurationMs = Math.round(
                (audioBuffer.length * 8) / 128
            );

            return {
                audioBuffer,
                format: "mp3",
                durationMs: estimatedDurationMs,
                latencyMs,
                voiceId,
                modelId: model,
                streamingUsed,
                success: true,
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            return {
                audioBuffer: null,
                format: "mp3",
                durationMs: null,
                latencyMs,
                voiceId,
                modelId: model,
                streamingUsed: false,
                success: false,
                errorMessage,
            };
        }
    }

    /**
     * List available voices from ElevenLabs.
     */
    async listVoices(): Promise<VoiceInfo[]> {
        try {
            if (!this.apiKey) {
                throw new Error("ELEVENLABS_API_KEY is not configured");
            }

            const response = await fetch(
                "https://api.elevenlabs.io/v1/voices",
                {
                    headers: {
                        "xi-api-key": this.apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(
                    `ElevenLabs API error ${response.status}`
                );
            }

            const data = (await response.json()) as {
                voices: Array<{
                    voice_id: string;
                    name: string;
                    category?: string;
                    description?: string;
                }>;
            };

            return (data.voices ?? []).map((v) => ({
                voiceId: v.voice_id,
                name: v.name,
                category: v.category,
                description: v.description,
            }));
        } catch {
            return [];
        }
    }

    /**
     * Split long text into chunks for incremental TTS synthesis.
     * Splits by paragraph first, then by sentence if paragraphs are too long.
     */
    chunkText(text: string): string[] {
        if (text.length <= MAX_CHUNK_LENGTH) {
            return [text];
        }

        const paragraphs = text.split(/\n\n+/);
        const chunks: string[] = [];
        let currentChunk = "";

        for (const paragraph of paragraphs) {
            if (
                currentChunk.length + paragraph.length + 2 >
                MAX_CHUNK_LENGTH
            ) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = "";
                }

                // If a single paragraph exceeds limit, split by sentences
                if (paragraph.length > MAX_CHUNK_LENGTH) {
                    const sentences = paragraph.match(
                        /[^.!?]+[.!?]+\s*/g
                    ) ?? [paragraph];
                    for (const sentence of sentences) {
                        if (
                            currentChunk.length + sentence.length >
                            MAX_CHUNK_LENGTH
                        ) {
                            if (currentChunk)
                                chunks.push(currentChunk.trim());
                            currentChunk = sentence;
                        } else {
                            currentChunk += sentence;
                        }
                    }
                } else {
                    currentChunk = paragraph;
                }
            } else {
                currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }
}
