/**
 * Level 7 — Deepgram STT Provider
 *
 * Alternative STT provider using Deepgram SDK.
 * Deepgram natively provides confidence scores per utterance.
 * Configurable via STT_PROVIDER=deepgram in .env.
 */

import type { STTProvider, STTResult, AudioInput } from "./types.js";

/** MIME type mapping for Deepgram */
const FORMAT_TO_MIMETYPE: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mp3",
    m4a: "audio/m4a",
    ogg: "audio/ogg",
    webm: "audio/webm",
    mpeg: "audio/mpeg",
    mp4: "audio/mp4",
    mpga: "audio/mpeg",
};

/**
 * Deepgram Speech-to-Text provider.
 */
export class DeepgramSTTProvider implements STTProvider {
    readonly name = "deepgram" as const;

    async transcribe(audio: AudioInput): Promise<STTResult> {
        const startTime = Date.now();

        try {
            const { createClient } = await import("@deepgram/sdk");
            const deepgram = createClient(
                process.env.DEEPGRAM_API_KEY ?? ""
            );

            const mimetype =
                FORMAT_TO_MIMETYPE[audio.format] ?? "audio/wav";

            const { result, error } =
                await deepgram.listen.prerecorded.transcribeFile(
                    audio.buffer,
                    {
                        model: "nova-2",
                        smart_format: true,
                        mimetype,
                    }
                );

            const latencyMs = Date.now() - startTime;

            if (error) {
                return {
                    text: "",
                    confidence: null,
                    provider: "deepgram",
                    latencyMs,
                    success: false,
                    errorMessage: error.message ?? String(error),
                };
            }

            // Extract transcription and confidence from Deepgram response
            const channel = result?.results?.channels?.[0];
            const alternative = channel?.alternatives?.[0];
            const text = alternative?.transcript ?? "";
            const confidence = alternative?.confidence ?? null;

            return {
                text: text.trim(),
                confidence,
                provider: "deepgram",
                latencyMs,
                success: true,
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            return {
                text: "",
                confidence: null,
                provider: "deepgram",
                latencyMs,
                success: false,
                errorMessage,
            };
        }
    }
}
