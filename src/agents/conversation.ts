import { Command } from "@langchain/langgraph";
import { getModel, mergeSystemPrompt } from "../models/factory.js";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { BaseClawStateType } from "../state.js";
import { getPromptRegistry } from "../observability/prompts.js";
import { withContext } from "./agent-middleware.js";
import type {
    AudioInput,
    VoiceConfig,
    STTResult,
    TTSResult,
    VoiceInputState,
} from "../voice/types.js";
import { validateAudioInput } from "../voice/validation.js";
import { createSTTProvider } from "../voice/stt/index.js";
import { ElevenLabsTTSProvider } from "../voice/tts/elevenlabs.js";
import { traceSTT, traceTTS } from "../observability/trace-metadata.js";

/**
 * Intent classification schema.
 * The Conversation Agent uses structured output to determine routing.
 */
const IntentSchema = z.object({
    intent: z
        .enum(["ideation", "planning", "execution", "review", "conversation"])
        .describe(
            "The classified intent of the user's message. " +
            "IMPORTANT: Default to routing to a specialist agent. Only use 'conversation' for trivial greetings, one-word answers, or pure small talk. " +
            "'ideation' for ANY request involving brainstorming, ideas, exploration, features, concepts, creative thinking, suggestions, or discussing possibilities. " +
            "'planning' for creating plans, strategies, task breakdowns, timelines, roadmaps, architecture, or organizing work. " +
            "'execution' for implementing, building, coding, executing tasks, writing code, or doing specific work. " +
            "'review' for reviewing work, quality checks, feedback, auditing, or evaluating something. " +
            "'conversation' ONLY for simple greetings like 'hi', 'hello', 'how are you', or very basic questions that need a one-sentence answer like 'what is your name'."
        ),
    reasoning: z
        .string()
        .describe("Brief reasoning for why this intent was chosen"),
    taskContext: z
        .string()
        .describe(
            "A concise summary of what the user wants, to pass as context to the target agent"
        ),
});

const DEFAULT_SYSTEM_PROMPT = `You are the Conversation Agent of Base Claw, a multi-agent system.

CORE PRINCIPLE: Only handle a request yourself if there is NO better-suited agent on the team. If another agent would do a better job, route to them immediately.

Your role:
- You are the ONLY user-facing agent. All user input comes through you, all responses go through you.
- Classify the user's intent and route to the specialist agent best suited to handle it.
- You should ONLY handle requests that are truly trivial and don't benefit from a specialist: greetings ("hi", "hello"), basic small talk, or simple factual questions with one-sentence answers.
- For EVERYTHING else, route to the best agent. If it involves ideas, brainstorming, features, concepts → Ideation. If it involves plans, strategies, structure → Planning. If it involves building, coding, executing → Execution. If it involves review, feedback, quality → Reviewer.
- Never reveal internal routing details to the user.

Your teammates:
- **Ideation Agent**: Brainstorming, ideas, features, concepts, exploration, creative thinking, suggestions, possibilities, "help me think about", "what could we build"
- **Planning Agent**: Creating plans, strategies, task decomposition, timelines, roadmaps, architecture decisions, organizing work
- **Execution Agent**: Implementing tasks, building things, coding, executing plans, writing specific content
- **Reviewer Agent**: Quality review, feedback, validation, checking completed work, auditing

Be warm, professional, and concise.`;

/** Load system prompt from PromptRegistry with fallback to hardcoded default */
async function getSystemPrompt(): Promise<string> {
    try {
        return await getPromptRegistry().loadPrompt("baseclaw-conversation-system");
    } catch {
        return DEFAULT_SYSTEM_PROMPT;
    }
}

const DEFAULT_RESPONSE_PROMPT = `You are the Conversation Agent of Base Claw, a multi-agent system.

You are now formatting the final response to the user. The specialist agent has completed their work.
Present their output naturally as if you are a unified assistant — never mention internal agents or routing.
Be warm, professional, and concise.`;

async function getResponsePrompt(): Promise<string> {
    try {
        return await getPromptRegistry().loadPrompt("baseclaw-conversation-response");
    } catch {
        return DEFAULT_RESPONSE_PROMPT;
    }
}

/** Model is resolved from centralized factory (configured via .env) */

/**
 * Conversation Agent Core — User I/O gateway.
 *
 * - Classifies intent via structured output
 * - Routes to specialist agents via Command
 * - Formats final responses back to the user
 * - Memory + skill context injected via contextMessages
 */
async function conversationAgentCore(
    state: BaseClawStateType,
    contextMessages: SystemMessage[]
): Promise<Command> {
    const iterationCount = state.iterationCount + 1;

    // Safety: check iteration limit
    if (iterationCount > state.maxIterations) {
        return new Command({
            goto: "__end__",
            update: {
                messages: [
                    new AIMessage(
                        "I've reached my processing limit for this request. Let me know if you'd like to continue."
                    ),
                ],
                currentAgent: "conversation",
                phase: "conversation",
                iterationCount,
            },
        });
    }

    const lastMessage = state.messages[state.messages.length - 1];

    // If the last message is from an AI (returning from reviewer/specialist), 
    // find the real specialist output and end the turn.
    if (
        lastMessage &&
        lastMessage._getType() === "ai" &&
        state.currentAgent !== "conversation"
    ) {
        // Find the real specialist output — skip any [Reviewer] metadata
        let specialistResponse: typeof lastMessage | null = null;
        for (let i = state.messages.length - 1; i >= 0; i--) {
            const msg = state.messages[i];
            if (msg._getType && msg._getType() === "ai") {
                const c = typeof msg.content === "string" ? msg.content : String(msg.content);
                if (!c.startsWith("[Reviewer]")) {
                    specialistResponse = msg;
                    break;
                }
            }
        }

        // Use the specialist response or fall back to the last message
        const responseToDeliver = specialistResponse || lastMessage;
        const responseContent = typeof responseToDeliver.content === "string"
            ? responseToDeliver.content : String(responseToDeliver.content);

        return new Command({
            goto: "__end__",
            update: {
                messages: [new AIMessage(responseContent)],
                currentAgent: "conversation",
                phase: "conversation",
                iterationCount,
            },
        });
    }

    // Classify intent for new user messages
    if (lastMessage && lastMessage._getType() === "human") {
        const classifierModel = getModel("conversation").withStructuredOutput(IntentSchema);
        const systemPrompt = await getSystemPrompt();

        const classification = await classifierModel.invoke([
            new SystemMessage(mergeSystemPrompt(systemPrompt, contextMessages)),
            new HumanMessage(
                `Classify the intent of this user message:\n\n"${lastMessage.content}"`
            ),
        ]);

        // General conversation — respond directly (no reviewer needed)
        if (classification.intent === "conversation") {
            const response = await getModel("conversation").invoke([
                new SystemMessage(mergeSystemPrompt(systemPrompt, contextMessages)),
                ...state.messages,
            ]);

            return new Command({
                goto: "__end__",
                update: {
                    messages: [response],
                    currentAgent: "conversation",
                    lastSpecialistAgent: "conversation",
                    phase: "conversation",
                    taskContext: classification.taskContext,
                    iterationCount,
                },
            });
        }

        // Route to specialist agent
        const targetAgent = classification.intent === "review" ? "reviewer" : classification.intent;
        return new Command({
            goto: targetAgent,
            update: {
                currentAgent: classification.intent,
                lastSpecialistAgent: classification.intent,
                phase: classification.intent,
                taskContext: classification.taskContext,
                iterationCount,
            },
        });
    }

    // Fallback — end turn
    return new Command({
        goto: "__end__",
        update: {
            currentAgent: "conversation",
            iterationCount,
        },
    });
}

/** Conversation Agent — wrapped with automatic memory + skill loading */
export const conversationAgent = withContext(conversationAgentCore, "conversation");

// ── Voice Processing Functions (Level 7) ───────────────────

/**
 * Process voice input: validate → transcribe → return text.
 *
 * After transcription, the text enters the normal pipeline — zero
 * capability difference between voice and text input.
 *
 * Audio is processed in memory. Temp files (if any) are deleted
 * immediately after STT API call.
 */
export async function processVoiceInput(
    audioInput: AudioInput,
    config: VoiceConfig
): Promise<{
    transcribedText: string;
    voiceInputState: VoiceInputState | null;
    errorMessage: string | null;
}> {
    // 1. Validate audio
    const validation = validateAudioInput(audioInput, config);
    if (!validation.valid) {
        // Trace the validation failure
        await traceSTT({
            audioFormat: audioInput.format,
            audioDurationMs: audioInput.durationMs ?? null,
            audioSizeBytes: audioInput.sizeBytes,
            provider: config.sttProvider,
            transcriptionText: "",
            confidenceScore: null,
            latencyMs: 0,
            success: false,
            errorMessage: validation.errorMessage ?? "Validation failed",
        });

        return {
            transcribedText: "",
            voiceInputState: null,
            errorMessage: validation.errorMessage,
        };
    }

    // 2. Transcribe via configured STT provider
    const sttProvider = createSTTProvider(config.sttProvider);
    const result: STTResult = await sttProvider.transcribe(audioInput);

    // 3. Trace the STT operation
    await traceSTT({
        audioFormat: audioInput.format,
        audioDurationMs: audioInput.durationMs ?? null,
        audioSizeBytes: audioInput.sizeBytes,
        provider: result.provider,
        transcriptionText: result.text,
        confidenceScore: result.confidence,
        latencyMs: result.latencyMs,
        success: result.success,
        errorMessage: result.errorMessage,
    });

    // 4. Handle STT failure
    if (!result.success) {
        return {
            transcribedText: "",
            voiceInputState: null,
            errorMessage:
                "I couldn't understand the audio. Please try again or type your message.",
        };
    }

    // 5. Handle empty transcription (silence)
    if (!result.text.trim()) {
        return {
            transcribedText: "",
            voiceInputState: null,
            errorMessage:
                "The audio appears to be silent or contains no speech. Please try again.",
        };
    }

    // 6. Log low confidence
    if (result.confidence !== null && result.confidence < 0.5) {
        console.warn(
            `⚠️ Low STT confidence (${result.confidence.toFixed(2)}) for transcription: "${result.text.slice(0, 100)}..."`
        );
    }

    // 7. Build VoiceInputState for graph state
    const voiceInputState: VoiceInputState = {
        audioFormat: audioInput.format,
        durationMs: audioInput.durationMs ?? 0,
        sizeBytes: audioInput.sizeBytes,
        transcribedText: result.text,
        sttProvider: result.provider,
        confidence: result.confidence,
    };

    return {
        transcribedText: result.text,
        voiceInputState,
        errorMessage: null,
    };
}

/**
 * Generate voice response via TTS.
 *
 * Text response is ALWAYS generated first (by the normal pipeline).
 * This function is called after the text response is ready.
 * TTS failure NEVER blocks the text response.
 *
 * @returns TTSResult or null if TTS is disabled/failed
 */
export async function generateVoiceResponse(
    text: string,
    config: VoiceConfig
): Promise<TTSResult | null> {
    // Check if TTS is enabled
    if (!config.ttsEnabled) {
        return null;
    }

    // Check if voice ID is configured
    if (!config.voiceId) {
        console.warn("⚠️ TTS enabled but no voice ID configured");
        return null;
    }

    const ttsProvider = new ElevenLabsTTSProvider();
    const result = await ttsProvider.synthesize(
        text,
        config.voiceId,
        config.modelId
    );

    // Trace the TTS operation (never throws)
    try {
        await traceTTS({
            inputTextPreview: text.slice(0, 500),
            voiceId: result.voiceId,
            modelId: result.modelId,
            audioDurationMs: result.durationMs,
            latencyMs: result.latencyMs,
            streamingUsed: result.streamingUsed,
            success: result.success,
            errorMessage: result.errorMessage,
        });
    } catch {
        // Tracing failure should never bubble up
    }

    if (!result.success) {
        console.error(
            `❌ TTS synthesis failed: ${result.errorMessage}`
        );
        // Text response is still delivered — TTS failure is non-blocking
        return null;
    }

    return result;
}

