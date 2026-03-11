import { Command } from "@langchain/langgraph";
import { getModel, mergeSystemPrompt } from "../models/factory.js";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { BaseClawStateType } from "../state.js";
import { getPromptRegistry } from "../observability/prompts.js";
import { withContext } from "./agent-middleware.js";

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

/** Routing schema — determines where to send the output next */
const RoutingSchema = z.object({
    nextAgent: z.enum(["reviewer", "planning", "execution"]).describe(
        "Where to send this output. Use 'planning' if the ideas are ready for a structured plan. " +
        "Use 'execution' if the solution is clear and ready to build. " +
        "Use 'reviewer' for general quality review (default)."
    ),
    reason: z.string().describe("Brief reason for this routing choice"),
});

/**
 * Ideation Agent Core — Brainstorming and creative exploration.
 *
 * After generating its response, this agent decides whether to hand off
 * to planning (ideas ready for a plan), execution (ready to build),
 * or reviewer (default quality gate).
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
        ...state.messages,
    ]);

    // Decide where to route — another specialist or reviewer
    const responseText = typeof response.content === "string"
        ? response.content : String(response.content);
    let nextAgent = "reviewer";
    try {
        const routingModel = getModel("conversation").withStructuredOutput(RoutingSchema);
        const routing = await routingModel.invoke([
            new SystemMessage(
                "You are a routing classifier. Based on the agent's output, decide where to send it next. " +
                "If the ideas are ready for a structured plan, send to 'planning'. " +
                "If the solution is clear and ready to implement, send to 'execution'. " +
                "Otherwise send to 'reviewer' for quality review."
            ),
            new HumanMessage(`Agent output:\n\n${responseText.slice(0, 1500)}`),
        ]);
        nextAgent = routing.nextAgent;
        console.log(`[Ideation] Routing to ${nextAgent}: ${routing.reason}`);
    } catch {
        nextAgent = "reviewer";
    }

    return new Command({
        goto: nextAgent,
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
