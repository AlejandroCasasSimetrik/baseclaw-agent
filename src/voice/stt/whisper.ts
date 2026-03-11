/**
 * Level 7 — OpenAI Whisper STT Provider
 *
 * Uses OpenAI's audio.transcriptions.create() API.
 * Primary STT provider for BaseClaw.
 *
 * Security: audio is processed in memory. If temp files are needed
 * for the API, they are deleted immediately after transcription.
 */

import type { STTProvider, STTResult, AudioInput } from "./types.js";

/**
 * OpenAI Whisper Speech-to-Text provider.
 */
export class WhisperSTTProvider implements STTProvider {
    readonly name = "whisper" as const;

    async transcribe(audio: AudioInput): Promise<STTResult> {
        const startTime = Date.now();

        try {
            // Dynamic import to avoid constructor-time API key validation
            const { default: OpenAI } = await import("openai");
            // Use OPENAI_EMBEDDING_KEY if available — it's a real OpenAI key.
            // OPENAI_API_KEY points to Cerebras which doesn't support audio APIs.
            const apiKey = process.env.OPENAI_EMBEDDING_KEY || process.env.OPENAI_API_KEY;
            const client = new OpenAI({
                apiKey,
                baseURL: "https://api.openai.com/v1",
            });

            // Create a File-like object from the buffer
            // Use ArrayBuffer slice to satisfy strict BlobPart type constraint
            const filename = audio.filename ?? `audio.${audio.format}`;
            const arrayBuf = audio.buffer.buffer.slice(
                audio.buffer.byteOffset,
                audio.buffer.byteOffset + audio.buffer.byteLength
            ) as ArrayBuffer;
            const file = new File([arrayBuf], filename, {
                type: `audio/${audio.format}`,
            });

            const transcription = await client.audio.transcriptions.create({
                model: "whisper-1",
                file,
                response_format: "verbose_json",
            });

            const latencyMs = Date.now() - startTime;
            const text =
                typeof transcription === "string"
                    ? transcription
                    : (transcription as any).text ?? "";

            // Whisper verbose_json may include segments with avg_logprob
            // which can serve as a rough confidence metric
            let confidence: number | null = null;
            if (
                typeof transcription === "object" &&
                Array.isArray((transcription as any).segments)
            ) {
                const segments = (transcription as any).segments;
                if (segments.length > 0) {
                    const avgLogProb =
                        segments.reduce(
                            (sum: number, s: any) =>
                                sum + (s.avg_logprob ?? 0),
                            0
                        ) / segments.length;
                    // Convert log probability to 0–1 scale (rough approximation)
                    confidence = Math.max(
                        0,
                        Math.min(1, Math.exp(avgLogProb))
                    );
                }
            }

            return {
                text: text.trim(),
                confidence,
                provider: "whisper",
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
                provider: "whisper",
                latencyMs,
                success: false,
                errorMessage,
            };
        }
    }
}
