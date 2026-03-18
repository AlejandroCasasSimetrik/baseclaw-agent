import { Command } from "@langchain/langgraph";
import { getModel, mergeSystemPrompt } from "../models/factory.js";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { BaseClawStateType } from "../state.js";
import type { CanvasWidgetState } from "../state.js";
import { getPromptRegistry } from "../observability/prompts.js";
import { withContext } from "./agent-middleware.js";
import { filterMessagesForLLM } from "./content-utils.js";

const DEFAULT_SYSTEM_PROMPT = `You are the Ideation Agent of Base Claw, a multi-agent system.

CORE PRINCIPLE: Only handle a request yourself if there is NO better-suited agent on the team. If another agent would do a better job, route to them. You are the best fit for brainstorming, idea exploration, and creative thinking. If the user needs a structured plan, route to Planning. If they need implementation, route to Execution. If they need quality review, route to Reviewer.

Your role:
- Help users brainstorm, explore ideas, and refine concepts
- Ask probing questions to uncover assumptions and constraints
- Generate multiple approaches and alternatives
- Map concepts and relationships
- Define scope and success criteria
- When structured user input is needed, infer coherent questions and answer choices from the actual conversation context
- Every answer choice must directly answer its question; avoid canned examples or topic-specific templates

Your teammates (route to them if they'd do better):
- **Planning Agent**: If the idea is ready and needs a structured plan, strategy, or task breakdown
- **Execution Agent**: If something needs to be built, coded, or implemented right now
- **Reviewer Agent**: If existing work needs quality review or validation

When your work is complete or you believe the idea is ready for planning, indicate that in your response.

Current task context: {{taskContext}}

Be creative, thorough, and help the user think beyond their initial framing.`;

const IDEATION_WIDGET_INSTRUCTIONS = `Structured response contract:
- When the best next step is to gather focused user input, return a canvasWidget questionnaire.
- Infer the questions and answer choices from the actual conversation context.
- Every answer choice must directly answer its question. Do not recycle choices from a different question.
- Do not rely on canned domain examples. The questionnaire must be grounded in the user's current topic.
- Use canvasWidget = null when a questionnaire is not needed.`;

const IdeationWidgetOptionSchema = z.object({
    label: z.string().min(1).describe("The user-facing answer label"),
    description: z.string().optional().default("").describe("Optional clarifying detail for this answer"),
});

const IdeationWidgetQuestionSchema = z.object({
    question: z.string().min(1).describe("A single, coherent question for the user"),
    options: z.array(IdeationWidgetOptionSchema)
        .min(2)
        .max(5)
        .describe("2-5 answer choices that directly answer the question"),
});

const IdeationCanvasWidgetSchema = z.object({
    type: z.literal("ideation-question"),
    title: z.string().optional().describe("Optional short title for the questionnaire"),
    description: z.string().optional().default("").describe("Optional context for why these questions matter"),
    questions: z.array(IdeationWidgetQuestionSchema)
        .min(1)
        .max(8)
        .describe("Ordered set of questions to ask one by one"),
});

const IdeationStructuredResponseSchema = z.object({
    responseText: z.string()
        .min(1)
        .describe("Natural-language response to accompany the result, even if the UI will render a widget"),
    canvasWidget: IdeationCanvasWidgetSchema
        .nullable()
        .describe("Questionnaire to show in the canvas when structured user input is needed; otherwise null"),
});

type IdeationStructuredResponse = z.infer<typeof IdeationStructuredResponseSchema>;

function normalizeWidgetText(text: string | null | undefined): string {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function looksQuestionLike(text: string): boolean {
    return text.includes("?") || /^(what|which|who|when|where|why|how)\b/i.test(text);
}

function sanitizeCanvasWidget(widget: IdeationStructuredResponse["canvasWidget"]): CanvasWidgetState | null {
    if (!widget) return null;

    const questions = (widget.questions || [])
        .map((question) => {
            const normalizedQuestion = normalizeWidgetText(question.question);
            const seen = new Set<string>();
            const options = (question.options || [])
                .map((option) => ({
                    label: normalizeWidgetText(option.label),
                    description: normalizeWidgetText(option.description),
                }))
                .filter((option) => {
                    const key = option.label.toLowerCase();
                    if (!option.label || seen.has(key)) return false;
                    if (looksQuestionLike(option.label)) return false;
                    seen.add(key);
                    return true;
                });

            if (!normalizedQuestion || options.length < 2) {
                return null;
            }

            return {
                question: normalizedQuestion,
                options,
            };
        })
        .filter((question): question is NonNullable<typeof question> => Boolean(question));

    if (questions.length === 0) return null;

    return {
        type: "ideation-question",
        title: normalizeWidgetText(widget.title) || "Ideation",
        description: normalizeWidgetText(widget.description),
        questions,
    };
}

async function getSystemPrompt(): Promise<string> {
    try {
        return await getPromptRegistry().loadPrompt("baseclaw-ideation-system");
    } catch {
        return DEFAULT_SYSTEM_PROMPT;
    }
}

/**
 * Ideation Agent Core — Brainstorming and creative exploration.
 *
 * After generating its response, routes to reviewer for quality gating.
 */
async function ideationAgentCore(
    state: BaseClawStateType,
    contextMessages: SystemMessage[]
): Promise<Command> {
    const iterationCount = state.iterationCount + 1;

    if (iterationCount > state.maxIterations) {
        return new Command({
            goto: "conversation",
            update: {
                messages: [
                    new AIMessage(
                        "[Ideation Agent] Reached iteration limit. Returning to conversation."
                    ),
                ],
                iterationCount,
            },
        });
    }

    const rawPrompt = await getSystemPrompt();
    const systemPrompt = rawPrompt.replace(
        "{{taskContext}}",
        state.taskContext || "No specific context provided"
    );

    const ideationModel = getModel("ideation").withStructuredOutput(IdeationStructuredResponseSchema);
    const structuredResponse = await ideationModel.invoke([
        new SystemMessage(mergeSystemPrompt(`${systemPrompt}\n\n${IDEATION_WIDGET_INSTRUCTIONS}`, contextMessages)),
        ...filterMessagesForLLM(state.messages),
    ]);
    const widget = sanitizeCanvasWidget(structuredResponse.canvasWidget);
    const responseText = normalizeWidgetText(structuredResponse.responseText)
        || (widget ? "I have a few focused questions that will help me guide the next step." : "Let's explore a few directions.");
    const response = new AIMessage({
        content: responseText,
        additional_kwargs: widget ? { canvasWidget: widget } : {},
    });

    // Always route to reviewer (quality gate) — cross-specialist routing
    // is handled by the conversation agent's intent classification, not here.
    return new Command({
        goto: "reviewer",
        update: {
            messages: [response],
            currentAgent: "ideation",
            lastSpecialistAgent: "ideation",
            phase: "ideation",
            canvasWidget: widget,
            iterationCount,
            reviewerGateState: {
                active: true,
                sourceAgent: "ideation",
                revisionCount: (state as any).reviewerGateState?.revisionCount ?? 0,
                revisionHistory: (state as any).reviewerGateState?.revisionHistory ?? [],
                currentReviewId: null,
                triggerType: "mandatory_gate",
                pendingFeedback: null,
            },
        },
    });
}

/** Ideation Agent — wrapped with automatic memory + skill loading */
export const ideationAgent = withContext(ideationAgentCore, "ideation");
