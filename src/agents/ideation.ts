import { Command } from "@langchain/langgraph";
import { getModel, mergeSystemPrompt } from "../models/factory.js";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseClawStateType } from "../state.js";
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

Your teammates (route to them if they'd do better):
- **Planning Agent**: If the idea is ready and needs a structured plan, strategy, or task breakdown
- **Execution Agent**: If something needs to be built, coded, or implemented right now
- **Reviewer Agent**: If existing work needs quality review or validation

When your work is complete or you believe the idea is ready for planning, indicate that in your response.

Current task context: {{taskContext}}

Be creative, thorough, and help the user think beyond their initial framing.`;

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

    const response = await getModel("ideation").invoke([
        new SystemMessage(mergeSystemPrompt(systemPrompt, contextMessages)),
        ...filterMessagesForLLM(state.messages),
    ]);

    // Always route to reviewer (quality gate) — cross-specialist routing
    // is handled by the conversation agent's intent classification, not here.
    return new Command({
        goto: "reviewer",
        update: {
            messages: [response],
            currentAgent: "ideation",
            lastSpecialistAgent: "ideation",
            phase: "ideation",
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
