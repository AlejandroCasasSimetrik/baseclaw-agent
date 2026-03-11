import { Command } from "@langchain/langgraph";
import { getModel, mergeSystemPrompt } from "../models/factory.js";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { BaseClawStateType } from "../state.js";
import { getPromptRegistry } from "../observability/prompts.js";
import { withContext } from "./agent-middleware.js";
import { extractTextContent } from "./content-utils.js";

const DEFAULT_SYSTEM_PROMPT = `You are the Planning Agent of Base Claw, a multi-agent system.

CORE PRINCIPLE: Only handle a request yourself if there is NO better-suited agent on the team. If another agent would do a better job, route to them. You are the best fit for creating structured plans, strategies, and task breakdowns. If the user needs creative brainstorming, route to Ideation. If they need implementation, route to Execution. If they need quality review, route to Reviewer.

Your role:
- Create structured, actionable plans from ideas or requirements
- Decompose complex tasks into clear, sequential steps
- Identify dependencies between tasks
- Estimate effort and timelines where possible
- Assess risks and propose mitigations
- Define clear success criteria for each task

Your teammates (route to them if they'd do better):
- **Ideation Agent**: If the request needs creative exploration or brainstorming before planning
- **Execution Agent**: If the plan is ready and something needs to be built or implemented
- **Reviewer Agent**: If existing work needs quality review or validation

When creating plans, be specific and actionable. Each step should be small enough to execute independently.

Current task context: {{taskContext}}

Be structured, thorough, and produce plans that can be handed directly to an execution agent.`;

async function getSystemPrompt(): Promise<string> {
    try {
        return await getPromptRegistry().loadPrompt("baseclaw-planning-system");
    } catch {
        return DEFAULT_SYSTEM_PROMPT;
    }
}

/** Routing schema — determines where to send the output next */
const RoutingSchema = z.object({
    nextAgent: z.enum(["reviewer", "ideation", "execution"]).describe(
        "Where to send this output. Use 'execution' if the plan is complete and ready to implement. " +
        "Use 'ideation' if more creative exploration is needed before finalizing. " +
        "Use 'reviewer' for general quality review (default)."
    ),
    reason: z.string().describe("Brief reason for this routing choice"),
});

/**
 * Planning Agent Core — Plan creation and task decomposition.
 *
 * After generating its plan, this agent decides whether to hand off
 * to execution (plan ready to implement), ideation (needs more exploration),
 * or reviewer (default quality gate).
 */
async function planningAgentCore(
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
                        "[Planning Agent] Reached iteration limit. Returning to conversation."
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

    const response = await getModel("planning").invoke([
        new SystemMessage(mergeSystemPrompt(systemPrompt, contextMessages)),
        ...state.messages,
    ]);

    // Decide where to route — another specialist or reviewer
    const responseText = extractTextContent(response.content);
    let nextAgent = "reviewer";
    try {
        const routingModel = getModel("conversation").withStructuredOutput(RoutingSchema);
        const routing = await routingModel.invoke([
            new SystemMessage(
                "You are a routing classifier. Based on the agent's plan output, decide where to send it next. " +
                "If the plan is complete and actionable, send to 'execution' so it can be implemented. " +
                "If the plan needs more creative exploration or brainstorming, send to 'ideation'. " +
                "Otherwise send to 'reviewer' for quality review."
            ),
            new HumanMessage(`Agent output:\n\n${responseText.slice(0, 1500)}`),
        ]);
        nextAgent = routing.nextAgent;
        console.log(`[Planning] Routing to ${nextAgent}: ${routing.reason}`);
    } catch {
        nextAgent = "reviewer";
    }

    return new Command({
        goto: nextAgent,
        update: {
            messages: [response],
            currentAgent: "planning",
            lastSpecialistAgent: "planning",
            phase: "planning",
            iterationCount,
            reviewerGateState: {
                active: true,
                sourceAgent: "planning",
                revisionCount: (state as any).reviewerGateState?.revisionCount ?? 0,
                revisionHistory: (state as any).reviewerGateState?.revisionHistory ?? [],
                currentReviewId: null,
                triggerType: "mandatory_gate",
                pendingFeedback: null,
            },
        },
    });
}

/** Planning Agent — wrapped with automatic memory + skill loading */
export const planningAgent = withContext(planningAgentCore, "planning");
