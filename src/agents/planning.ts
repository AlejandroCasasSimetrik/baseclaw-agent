import { Command } from "@langchain/langgraph";
import { getModel, mergeSystemPrompt } from "../models/factory.js";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseClawStateType } from "../state.js";
import { getPromptRegistry } from "../observability/prompts.js";
import { withContext } from "./agent-middleware.js";
import { filterMessagesForLLM } from "./content-utils.js";

const DEFAULT_SYSTEM_PROMPT = `You are the Planning Agent of Base Claw, a multi-agent system.

CORE PRINCIPLE: Only handle a request yourself if there is NO better-suited agent on the team. If another agent would do a better job, route to them. You are the best fit for creating structured plans, strategies, and task breakdowns. If the user needs creative brainstorming, route to Ideation. If they need implementation, route to Execution. If they need quality review, route to Reviewer.

Your role is to create CONCISE, HIGH-LEVEL plans.

Each step = a broad PHASE, not a granular task. Group related work together. Minimize the number of top-level steps — use as few as needed to cover the work.

CORRECT example for "Plan a trip to Japan":
1. **Research & Inspiration** — Research destinations, culture, seasons, visa requirements
2. **Logistics & Booking** — Book flights, accommodation, travel insurance, JR pass
3. **Itinerary Design** — Day-by-day itinerary balancing cities, nature, culture
4. **Budget & Preparation** — Budget breakdown, packing, currency, apps, language basics

WRONG (too granular): "Research Tokyo", "Research Kyoto", "Research Osaka", "Book flight", "Book hotel in Tokyo", "Book hotel in Kyoto"... (40+ steps)

Rules:
- Each step may have 2-4 bullet sub-steps for detail
- Think in PHASES not individual tasks
- Always consolidate related work into a single step

Your teammates (route to them if they'd do better):
- **Ideation Agent**: If the request needs creative exploration or brainstorming before planning
- **Execution Agent**: If the plan is ready and something needs to be built or implemented
- **Reviewer Agent**: If existing work needs quality review or validation

Current task context: {{taskContext}}

Be concise. Produce a plan with broad, top-level phases.`;


async function getSystemPrompt(): Promise<string> {
    try {
        return await getPromptRegistry().loadPrompt("baseclaw-planning-system");
    } catch {
        return DEFAULT_SYSTEM_PROMPT;
    }
}

/**
 * Planning Agent Core — Plan creation and task decomposition.
 *
 * After generating its plan, routes to reviewer for quality gating.
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
        ...filterMessagesForLLM(state.messages),
    ]);

    // Always route to reviewer (quality gate) — cross-specialist routing
    // is handled by the conversation agent's intent classification, not here.
    return new Command({
        goto: "reviewer",
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
