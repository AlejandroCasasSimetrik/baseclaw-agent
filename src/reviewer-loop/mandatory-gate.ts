/**
 * Level 10 — Mandatory Gate
 *
 * THE most important module in Level 10. This is the LangGraph node function
 * that enforces mandatory review of every agent output.
 *
 * Graph-level enforcement:
 *   - Ideation, Planning, and Execution agents route to "reviewerGate"
 *   - The reviewerGate node scores the output, decides verdict, and routes:
 *     → auto-continues with next queued task if approved AND tasks are queued
 *     → "conversation" if approved AND no tasks queued (respond to user)
 *     → back to source agent if needs_revision (with feedback in state)
 *     → triggers HITL if needs_hitl
 *   - There is NO code path from agent completion to output delivery
 *     that bypasses this node.
 *
 * Traced as LangSmith spans: reviewer.gate.*
 */

import { Command } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { traceable } from "langsmith/traceable";
import { v4 as uuidv4 } from "uuid";
import type { BaseClawStateType } from "../state.js";
import { scoreOutput } from "./quality-scorer.js";
import { generateFeedback, formatFeedbackForAgent } from "./feedback-generator.js";
import {
    createRevisionRound,
    shouldEscalateToHITL,
    recordRevisionRound,
    formatRevisionHistory,
} from "./revision-manager.js";
import type {
    ReviewerGateState,
    QualityAssessment,
    StructuredFeedback,
    RevisionRound,
} from "./types.js";
import { defaultReviewerGateState, getReviewConfig } from "./types.js";
import { triggerHITL } from "../hitl/trigger.js";
import { ContinuousTaskManager } from "../heartbeat/task-manager.js";

// ── Agents that pass through the mandatory gate ──────────

const GATED_AGENTS = new Set(["ideation", "planning", "execution"]);

// ── Mandatory Gate Node ──────────────────────────────────

/**
 * The mandatory review gate — a LangGraph node function.
 *
 * Intercepts every output from ideation, planning, and execution agents.
 * Performs quality scoring and routes based on the verdict.
 *
 * This function is added as a node in the LangGraph graph.
 */
export async function reviewerGateNode(
    state: BaseClawStateType
): Promise<Command> {
    // Get the gate state
    const gateState: ReviewerGateState =
        (state as any).reviewerGateState ?? defaultReviewerGateState();

    const tenantId = (state as any).tenantId ?? "default";

    // Determine source agent from state
    const sourceAgent = gateState.sourceAgent ?? state.currentAgent ?? "execution";
    const isGatedAgent = GATED_AGENTS.has(sourceAgent);

    // If the source agent is not a gated agent, pass through
    if (!isGatedAgent) {
        return new Command({
            goto: "conversation",
            update: {
                reviewerGateState: defaultReviewerGateState(),
            },
        });
    }

    // Extract the agent's output (most recent AI message)
    const agentOutput = _extractAgentOutput(state);
    if (!agentOutput) {
        // No output to review — pass through
        return new Command({
            goto: "conversation",
            update: {
                reviewerGateState: defaultReviewerGateState(),
            },
        });
    }

    // Run the review
    return _runReview(state, gateState, sourceAgent, agentOutput, tenantId);
}

// ── Core Review Logic ────────────────────────────────────

const _runReview = traceable(
    async (
        state: BaseClawStateType,
        gateState: ReviewerGateState,
        sourceAgent: string,
        agentOutput: string,
        tenantId: string
    ): Promise<Command> => {
        const config = getReviewConfig();
        const revisionHistory = gateState.revisionHistory || [];

        // Score the output
        const assessment = await scoreOutput(
            agentOutput,
            state.taskContext || "No context provided",
            sourceAgent as any,
            gateState.triggerType ?? "mandatory_gate",
            revisionHistory
        );

        // Create a revision round record
        const roundNumber = gateState.revisionCount + 1;
        const revisionRound = createRevisionRound(
            roundNumber,
            agentOutput,
            assessment,
            null // feedback populated below if needed
        );

        // Record the round to episodic memory (fire-and-forget)
        recordRevisionRound(revisionRound, tenantId).catch(() => { });

        // Determine action based on verdict
        switch (assessment.verdict) {
            case "approved":
                return _handleApproved(state, gateState, assessment);

            case "needs_revision":
                return _handleNeedsRevision(
                    state,
                    gateState,
                    assessment,
                    agentOutput,
                    revisionRound,
                    tenantId
                );

            case "needs_hitl":
                return _handleNeedsHITL(
                    state,
                    gateState,
                    assessment,
                    agentOutput,
                    tenantId
                );

            default:
                // Unknown verdict — approve and continue
                return _handleApproved(state, gateState, assessment);
        }
    },
    { name: "reviewer.gate.review", run_type: "chain" }
);

/**
 * Output approved — check for queued continuous tasks, auto-continue if available.
 * If no tasks are queued, route to conversation agent as usual.
 */
async function _handleApproved(
    state: BaseClawStateType,
    gateState: ReviewerGateState,
    assessment: QualityAssessment
): Promise<Command> {
    const tenantId = (state as any).tenantId ?? "default";

    // ── Check for queued continuous tasks ──────────────────
    try {
        const taskManager = new ContinuousTaskManager(tenantId);
        const nextTask = await taskManager.getNextTask();

        if (nextTask) {
            console.log(
                `[ReviewerGate] Approved. Auto-continuing with task: "${nextTask.title}" (${nextTask.id})`
            );

            // Mark the task as in-progress
            await taskManager.markInProgress(nextTask.id);

            // Route to the appropriate agent with the task injected
            return _autoContinueWithTask(state, nextTask);
        }
    } catch (err) {
        // Task queue unavailable (DB down) — fall through to normal flow
        console.warn("[ReviewerGate] Could not check task queue:", (err as Error).message);
    }

    // ── No queued tasks — send non-blocking notification & route to conversation ──
    // The user sees the result, but the heartbeat keeps running.
    try {
        await triggerHITL(
            `Task completed. Review score: ${assessment.overallScore}/100.`,
            {
                verdict: assessment.verdict,
                overallScore: assessment.overallScore,
                sourceAgent: assessment.sourceAgent,
            },
            "reviewer",
            tenantId,
            undefined,
            false // non-blocking — don't pause the heartbeat
        );
    } catch {
        // Notification failure is non-critical — continue
    }

    return new Command({
        goto: "conversation",
        update: {
            currentAgent: "reviewer",
            phase: "review",
            reviewerGateState: defaultReviewerGateState(),
            iterationCount: state.iterationCount + 1,
        },
    });
}

// ── Auto-Continuation Helpers ────────────────────────────

/**
 * Known specialist agents in the graph.
 */
const SPECIALIST_AGENTS = new Set(["ideation", "planning", "execution", "reviewer"]);

/**
 * Resolve which graph node should handle a continuous task.
 *
 * - Explicit assignment ("ideation", "planning", "execution", "reviewer") → route directly
 * - "auto" or unknown → route through "conversation" for classification
 */
function _resolveAgentForTask(assignedAgent: string): string {
    if (SPECIALIST_AGENTS.has(assignedAgent)) {
        return assignedAgent;
    }
    // "auto" or any unknown value → conversation agent will classify it
    return "conversation";
}

/**
 * Build a Command that injects a continuous task into the conversation
 * and routes to the appropriate agent.
 *
 * The task description is injected as a HumanMessage so the agent
 * treats it as a new user request. taskContext is also set so agents
 * have the full context.
 */
function _autoContinueWithTask(
    state: BaseClawStateType,
    task: { id: string; title: string; description: string; assignedAgent: string }
): Command {
    const targetAgent = _resolveAgentForTask(task.assignedAgent);

    const taskMessage = new HumanMessage(
        `[Continuous Task: ${task.title}]\n\n${task.description}`
    );

    return new Command({
        goto: targetAgent,
        update: {
            messages: [taskMessage],
            currentAgent: "reviewer",
            lastSpecialistAgent: "reviewer",
            phase: "conversation",
            taskContext: `Continuous Task: ${task.title} — ${task.description}`,
            reviewerGateState: defaultReviewerGateState(),
            iterationCount: 0, // Reset for the new task cycle
        },
    });
}

/**
 * Output needs revision — check escalation, then route feedback to source agent.
 */
async function _handleNeedsRevision(
    state: BaseClawStateType,
    gateState: ReviewerGateState,
    assessment: QualityAssessment,
    agentOutput: string,
    revisionRound: RevisionRound,
    tenantId: string
): Promise<Command> {
    const config = getReviewConfig();
    const updatedHistory = [...(gateState.revisionHistory || []), revisionRound];

    // Check if we should escalate to HITL instead
    const escalation = shouldEscalateToHITL(updatedHistory, config.maxRevisionRounds);
    if (escalation.shouldEscalate) {
        return _handleEscalation(state, gateState, assessment, agentOutput, tenantId, escalation.reason);
    }

    // Generate structured feedback
    const maxRevisionsRemaining =
        config.maxRevisionRounds - updatedHistory.length;
    const feedback = await generateFeedback(
        assessment,
        agentOutput,
        state.taskContext || "",
        maxRevisionsRemaining
    );

    // Update the revision round with feedback
    revisionRound.feedback = feedback;

    // Format feedback for injection into agent context
    const feedbackMessage = formatFeedbackForAgent(feedback);

    // Route back to the source agent with feedback
    const sourceAgent = assessment.sourceAgent;

    return new Command({
        goto: sourceAgent,
        update: {
            messages: [
                new SystemMessage(
                    `[Reviewer Gate] Your output needs revision. Score: ${assessment.overallScore}/100.\n\n${feedbackMessage}`
                ),
            ],
            currentAgent: "reviewer",
            phase: "review",
            iterationCount: state.iterationCount + 1,
            reviewerGateState: {
                active: true,
                sourceAgent,
                revisionCount: updatedHistory.length,
                revisionHistory: updatedHistory,
                currentReviewId: assessment.reviewId,
                triggerType: gateState.triggerType ?? "mandatory_gate",
                pendingFeedback: feedback,
            } as any,
        },
    });
}

/**
 * Output needs HITL — trigger immediately.
 */
async function _handleNeedsHITL(
    state: BaseClawStateType,
    gateState: ReviewerGateState,
    assessment: QualityAssessment,
    agentOutput: string,
    tenantId: string
): Promise<Command> {
    const historyStr = formatRevisionHistory(gateState.revisionHistory || []);

    try {
        await triggerHITL(
            `Quality score (${assessment.overallScore}/100) below HITL threshold. ` +
            `Source: ${assessment.sourceAgent}. ` +
            `Task: ${state.taskContext?.slice(0, 200) || "Unknown"}.`,
            {
                assessment: {
                    overallScore: assessment.overallScore,
                    verdict: assessment.verdict,
                    dimensions: assessment.dimensions.map((d) => ({
                        dimension: d.dimension,
                        score: d.score,
                    })),
                    confidence: assessment.confidence,
                },
                systemAwareness: assessment.systemAwareness,
                agentOutput: agentOutput.slice(0, 2000),
                revisionHistory: historyStr,
            },
            "reviewer",
            tenantId,
            undefined,
            true // blocking — human must respond before execution continues
        );
    } catch {
        // HITL trigger may fail if already pending — continue gracefully
    }

    return new Command({
        goto: "conversation",
        update: {
            messages: [
                new AIMessage(
                    `[Reviewer Gate] Quality score ${assessment.overallScore}/100 ` +
                    `is below the HITL threshold. Human review has been requested.`
                ),
            ],
            currentAgent: "reviewer",
            phase: "review",
            iterationCount: state.iterationCount + 1,
            reviewerGateState: defaultReviewerGateState(),
            hitlState: { pending: true, requestId: assessment.reviewId },
        },
    });
}

/**
 * Handle escalation to HITL after max revisions or stagnation.
 */
async function _handleEscalation(
    state: BaseClawStateType,
    gateState: ReviewerGateState,
    assessment: QualityAssessment,
    agentOutput: string,
    tenantId: string,
    reason: string
): Promise<Command> {
    const historyStr = formatRevisionHistory(gateState.revisionHistory || []);

    try {
        await triggerHITL(
            `Revision loop escalation: ${reason}`,
            {
                escalationReason: reason,
                assessment: {
                    overallScore: assessment.overallScore,
                    verdict: assessment.verdict,
                },
                revisionHistory: historyStr,
                agentOutput: agentOutput.slice(0, 2000),
            },
            "reviewer",
            tenantId,
            undefined,
            true // blocking — human must respond before execution continues
        );
    } catch {
        // Already pending — continue
    }

    return new Command({
        goto: "conversation",
        update: {
            messages: [
                new AIMessage(
                    `[Reviewer Gate] Revision loop escalated to human review. Reason: ${reason}`
                ),
            ],
            currentAgent: "reviewer",
            phase: "review",
            iterationCount: state.iterationCount + 1,
            reviewerGateState: defaultReviewerGateState(),
            hitlState: { pending: true, requestId: assessment.reviewId },
        },
    });
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Extract the most recent agent output from state messages.
 */
function _extractAgentOutput(state: BaseClawStateType): string | null {
    const messages = state.messages || [];
    // Walk backwards to find the last AI message
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg._getType && msg._getType() === "ai") {
            return typeof msg.content === "string"
                ? msg.content
                : String(msg.content);
        }
        // Fallback: check constructor name
        if (
            msg.constructor?.name === "AIMessage" ||
            msg.constructor?.name === "AIMessageChunk"
        ) {
            return typeof msg.content === "string"
                ? msg.content
                : String(msg.content);
        }
    }
    return null;
}
