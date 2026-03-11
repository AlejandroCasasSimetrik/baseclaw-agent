import { StateGraph } from "@langchain/langgraph";
import { BaseClawState } from "./state.js";
import { conversationAgent } from "./agents/conversation.js";
import { ideationAgent } from "./agents/ideation.js";
import { planningAgent } from "./agents/planning.js";
import { executionAgent } from "./agents/execution.js";
import { reviewerAgent } from "./agents/reviewer.js";

/**
 * Base Claw Agent Graph
 *
 * Full mesh topology — every main agent can route to every other agent
 * via Command-based routing. Conversation Agent is the entry/exit point.
 *
 * Unified Reviewer Flow:
 *   - ALL agent outputs (including conversation) route through "reviewer"
 *   - The reviewer scores quality and routes:
 *     → "conversation" if approved (conversation formats final response → __end__)
 *     → back to source agent if revision needed (with feedback)
 *     → triggers HITL if quality is below threshold
 *   - Conversation is ALWAYS the last agent before __end__
 *
 * Graph structure:
 *   __start__ → conversation
 *   conversation → reviewer (for own responses or routing to specialists)
 *   specialists (ideation/planning/execution) → reviewer
 *   reviewer → conversation (approved) or back to specialist (revision)
 *   conversation → __end__ (final response delivery)
 */
export function buildGraph() {
    const workflow = new StateGraph(BaseClawState)
        // ── Nodes ──────────────────────────────────────────────
        .addNode("conversation", conversationAgent, {
            ends: ["ideation", "planning", "execution", "reviewer", "__end__"],
        })
        .addNode("ideation", ideationAgent, {
            ends: [
                "conversation",
                "planning",
                "execution",
                "reviewer",
                "__end__",
            ],
        })
        .addNode("planning", planningAgent, {
            ends: [
                "conversation",
                "ideation",
                "execution",
                "reviewer",
                "__end__",
            ],
        })
        .addNode("execution", executionAgent, {
            ends: [
                "conversation",
                "ideation",
                "planning",
                "reviewer",
                "__end__",
            ],
        })
        .addNode("reviewer", reviewerAgent, {
            ends: [
                "conversation",
                "ideation",
                "planning",
                "execution",
                "__end__",
            ],
        })
        // ── Entry point ────────────────────────────────────────
        .addEdge("__start__", "conversation");

    return workflow.compile();
}
