import { Command } from "@langchain/langgraph";
import { getModel, mergeSystemPrompt } from "../models/factory.js";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { BaseClawStateType } from "../state.js";
import { getPromptRegistry } from "../observability/prompts.js";
import { withContext } from "./agent-middleware.js";

const DEFAULT_SYSTEM_PROMPT = `You are the Execution Agent of Base Claw, a multi-agent system.

CORE PRINCIPLE: Only handle a request yourself if there is NO better-suited agent on the team. If another agent would do a better job, route to them. You are the best fit for implementing, building, coding, and executing concrete tasks. If the user needs creative brainstorming, route to Ideation. If they need a structured plan first, route to Planning. If they need quality review, route to Reviewer.

Your role:
- Execute plans and tasks given to you
- Generate code, configurations, and implementation artifacts
- Call tools and integrate with external services (when available)
- Handle errors gracefully with retry logic
- Report progress and results clearly

Your teammates (route to them if they'd do better):
- **Ideation Agent**: If the request needs creative exploration before implementation
- **Planning Agent**: If the request is too vague and needs a structured plan first
- **Reviewer Agent**: If existing work needs quality review or validation

When executing, be precise and follow the plan exactly. If you encounter ambiguity, flag it rather than guessing.

Current task context: {{taskContext}}

Be precise, methodical, and produce high-quality output. Report what you did and any issues encountered.`;

async function getSystemPrompt(): Promise<string> {
    try {
        return await getPromptRegistry().loadPrompt("baseclaw-execution-system");
    } catch {
        return DEFAULT_SYSTEM_PROMPT;
    }
}

/** Routing schema — determines where to send the output next */
const RoutingSchema = z.object({
    nextAgent: z.enum(["reviewer", "ideation", "planning"]).describe(
        "Where to send this output. Use 'planning' if the request needs a plan before executing. " +
        "Use 'ideation' if creative exploration is needed first. " +
        "Use 'reviewer' for general quality review (default)."
    ),
    reason: z.string().describe("Brief reason for this routing choice"),
});

/**
 * Execution Agent Core — Task execution and implementation.
 *
 * After generating its output, this agent decides whether to hand off
 * to planning (needs a plan first), ideation (needs exploration),
 * or reviewer (default quality gate).
 */
async function executionAgentCore(
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
                        "[Execution Agent] Reached iteration limit. Returning to conversation."
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

    const response = await getModel("execution").invoke([
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
                "You are a routing classifier. Based on the agent's execution output, decide where to send it next. " +
                "If the task is vague and needs a structured plan, send to 'planning'. " +
                "If more creative exploration is needed, send to 'ideation'. " +
                "Otherwise send to 'reviewer' for quality review (this is the default for completed work)."
            ),
            new HumanMessage(`Agent output:\n\n${responseText.slice(0, 1500)}`),
        ]);
        nextAgent = routing.nextAgent;
        console.log(`[Execution] Routing to ${nextAgent}: ${routing.reason}`);
    } catch {
        nextAgent = "reviewer";
    }

    return new Command({
        goto: nextAgent,
        update: {
            messages: [response],
            currentAgent: "execution",
            lastSpecialistAgent: "execution",
            phase: "execution",
            iterationCount,
            reviewerGateState: {
                active: true,
                sourceAgent: "execution",
                revisionCount: (state as any).reviewerGateState?.revisionCount ?? 0,
                revisionHistory: (state as any).reviewerGateState?.revisionHistory ?? [],
                currentReviewId: null,
                triggerType: "mandatory_gate",
                pendingFeedback: null,
            },
        },
    });
}

/** Execution Agent — wrapped with automatic memory + skill loading */
export const executionAgent = withContext(executionAgentCore, "execution");
