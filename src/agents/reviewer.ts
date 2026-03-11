import { Command } from "@langchain/langgraph";
import { getModel as getFactoryModel } from "../models/factory.js";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseClawStateType } from "../state.js";
import { getPromptRegistry } from "../observability/prompts.js";
import { withContext } from "./agent-middleware.js";
import { extractTextContent } from "./content-utils.js";
import { scoreOutput } from "../reviewer-loop/quality-scorer.js";
import { generateFeedback, formatFeedbackForAgent } from "../reviewer-loop/feedback-generator.js";
import {
    createRevisionRound,
    shouldEscalateToHITL,
    recordRevisionRound,
} from "../reviewer-loop/revision-manager.js";
import type {
    ReviewerGateState,
    QualityAssessment,
    RevisionRound,
} from "../reviewer-loop/types.js";
import { defaultReviewerGateState, getReviewConfig } from "../reviewer-loop/types.js";
import { triggerHITL } from "../hitl/trigger.js";
import { ContinuousTaskManager } from "../heartbeat/task-manager.js";
import { HumanMessage } from "@langchain/core/messages";

const DEFAULT_SYSTEM_PROMPT = `You are the Reviewer Agent of Base Claw, a multi-agent system.

CORE PRINCIPLE: Only handle a request yourself if there is NO better-suited agent on the team. If another agent would do a better job, route to them. You are the best fit for quality review, validation, scoring, and feedback. If the user needs creative brainstorming, route to Ideation. If they need a structured plan, route to Planning. If they need implementation, route to Execution.

Your role:
- Review and validate outputs from other agents
- Score quality on clear, defined criteria
- Provide structured, actionable feedback
- Synthesize feedback for revision cycles
- YOU are the ONLY agent that can trigger Human-in-the-Loop (HITL)
- When something requires genuine human judgment, flag it clearly

Your teammates (route to them if they'd do better):
- **Ideation Agent**: If the request needs creative exploration or brainstorming
- **Planning Agent**: If the request needs a structured plan or strategy
- **Execution Agent**: If something needs to be built, coded, or implemented

HITL Trigger Criteria:
- Ambiguous requirements that only a human can clarify
- High-risk actions with irreversible consequences
- Quality below acceptable thresholds after revision attempts
- Ethical or policy concerns

When reviewing, be objective, specific, and constructive. Score on a clear scale and explain your reasoning.

Current task context: {{taskContext}}

Be thorough, fair, and hold work to high standards.`;

async function getSystemPrompt(): Promise<string> {
    try {
        return await getPromptRegistry().loadPrompt("baseclaw-reviewer-system");
    } catch {
        return DEFAULT_SYSTEM_PROMPT;
    }
}

/** Model is resolved from centralized factory (configured via .env) */

// ── Gated Agents (outputs that need quality scoring) ──────
const GATED_AGENTS = new Set(["ideation", "planning", "execution", "conversation"]);

/**
 * Unified Reviewer Agent — Quality control gate + HITL gatekeeper.
 *
 * ALL agent outputs (including conversation) pass through this node.
 * It performs quality scoring, and routes:
 *   → "conversation" if approved (conversation formats final response → __end__)
 *   → back to source agent if revision needed (with feedback)
 *   → triggers HITL if quality is below threshold
 */
async function reviewerAgentCore(
    state: BaseClawStateType,
    contextMessages: SystemMessage[]
): Promise<Command> {
    const iterationCount = state.iterationCount + 1;

    // Safety: check iteration limit
    if (iterationCount > state.maxIterations) {
        return new Command({
            goto: "conversation",
            update: {
                messages: [
                    new AIMessage(
                        "[Reviewer] Reached iteration limit. Returning to conversation."
                    ),
                ],
                currentAgent: "reviewer",
                phase: "review",
                iterationCount,
                reviewerGateState: defaultReviewerGateState(),
            },
        });
    }

    // Get the gate state
    const gateState: ReviewerGateState =
        (state as any).reviewerGateState ?? defaultReviewerGateState();
    const tenantId = (state as any).tenantId ?? "default";

    // Determine source agent
    const sourceAgent = gateState.sourceAgent ?? state.currentAgent ?? "conversation";
    const isGatedAgent = GATED_AGENTS.has(sourceAgent);

    // If the source agent is not gated (edge case), pass through to conversation
    if (!isGatedAgent) {
        return new Command({
            goto: "conversation",
            update: {
                currentAgent: "reviewer",
                phase: "review",
                reviewerGateState: defaultReviewerGateState(),
                iterationCount,
            },
        });
    }

    // Extract the agent's output (most recent AI message)
    const agentOutput = _extractAgentOutput(state);
    if (!agentOutput) {
        // No output to review — pass through to conversation
        return new Command({
            goto: "conversation",
            update: {
                currentAgent: "reviewer",
                phase: "review",
                reviewerGateState: defaultReviewerGateState(),
                iterationCount,
            },
        });
    }

    // ── Run quality scoring ──────────────────────────────
    const config = getReviewConfig();
    const revisionHistory = gateState.revisionHistory || [];

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
        null
    );

    // Record the round to episodic memory (fire-and-forget)
    recordRevisionRound(revisionRound, tenantId).catch(() => { });

    // Log the review
    console.log(
        `🔍 [Reviewer] ${sourceAgent} output scored ${assessment.overallScore}/100 → ${assessment.verdict}`
    );

    // ── Route based on verdict ──────────────────────────
    switch (assessment.verdict) {
        case "approved":
            return _handleApproved(state, gateState, assessment, iterationCount, tenantId);

        case "needs_revision":
            return _handleNeedsRevision(
                state, gateState, assessment, agentOutput,
                revisionRound, tenantId, iterationCount
            );

        case "needs_hitl":
            return _handleNeedsHITL(
                state, gateState, assessment, agentOutput,
                tenantId, iterationCount
            );

        default:
            // Unknown verdict — approve and continue
            return _handleApproved(state, gateState, assessment, iterationCount, tenantId);
    }
}

// ── Verdict Handlers ────────────────────────────────────

/**
 * Output approved — route to conversation for final formatting.
 * Also checks for queued continuous tasks.
 */
async function _handleApproved(
    state: BaseClawStateType,
    gateState: ReviewerGateState,
    assessment: QualityAssessment,
    iterationCount: number,
    tenantId: string
): Promise<Command> {
    // ── Check for queued continuous tasks ──────────────────
    try {
        const taskManager = new ContinuousTaskManager(tenantId);
        const nextTask = await taskManager.getNextTask();

        if (nextTask) {
            console.log(
                `[Reviewer] Approved. Auto-continuing with task: "${nextTask.title}" (${nextTask.id})`
            );
            await taskManager.markInProgress(nextTask.id);
            return _autoContinueWithTask(state, nextTask);
        }
    } catch (err) {
        console.warn("[Reviewer] Could not check task queue:", (err as Error).message);
    }

    // ── No queued tasks — route to conversation for final response ──
    return new Command({
        goto: "conversation",
        update: {
            currentAgent: "reviewer",
            phase: "review",
            reviewerGateState: defaultReviewerGateState(),
            iterationCount,
        },
    });
}

/**
 * Output needs revision — send feedback back to source agent.
 */
async function _handleNeedsRevision(
    state: BaseClawStateType,
    gateState: ReviewerGateState,
    assessment: QualityAssessment,
    agentOutput: string,
    revisionRound: RevisionRound,
    tenantId: string,
    iterationCount: number
): Promise<Command> {
    const config = getReviewConfig();
    const updatedHistory = [...(gateState.revisionHistory || []), revisionRound];

    // Check if we should escalate to HITL
    const escalation = shouldEscalateToHITL(updatedHistory, config.maxRevisionRounds);
    if (escalation.shouldEscalate) {
        return _handleEscalation(state, gateState, assessment, agentOutput, tenantId, escalation.reason, iterationCount);
    }

    // Generate structured feedback
    const maxRevisionsRemaining = config.maxRevisionRounds - updatedHistory.length;
    const feedback = await generateFeedback(
        assessment, agentOutput, state.taskContext || "", maxRevisionsRemaining
    );

    revisionRound.feedback = feedback;
    const feedbackMessage = formatFeedbackForAgent(feedback);
    const sourceAgent = assessment.sourceAgent;

    return new Command({
        goto: sourceAgent,
        update: {
            messages: [
                new HumanMessage(
                    `[Reviewer Feedback] Your output needs revision. Score: ${assessment.overallScore}/100.\n\n${feedbackMessage}`
                ),
            ],
            currentAgent: "reviewer",
            phase: "review",
            iterationCount,
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
 * Output needs HITL — trigger human review.
 */
async function _handleNeedsHITL(
    state: BaseClawStateType,
    gateState: ReviewerGateState,
    assessment: QualityAssessment,
    agentOutput: string,
    tenantId: string,
    iterationCount: number
): Promise<Command> {
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
                agentOutput: agentOutput.slice(0, 2000),
            },
            "reviewer",
            tenantId,
            undefined,
            true
        );
    } catch {
        // Already pending
    }

    return new Command({
        goto: "conversation",
        update: {
            messages: [
                new AIMessage(
                    `[Reviewer] Quality score ${assessment.overallScore}/100 ` +
                    `is below the HITL threshold. Human review has been requested.`
                ),
            ],
            currentAgent: "reviewer",
            phase: "review",
            iterationCount,
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
    reason: string,
    iterationCount: number
): Promise<Command> {
    try {
        await triggerHITL(
            `Revision loop escalation: ${reason}`,
            {
                escalationReason: reason,
                assessment: {
                    overallScore: assessment.overallScore,
                    verdict: assessment.verdict,
                },
                agentOutput: agentOutput.slice(0, 2000),
            },
            "reviewer",
            tenantId,
            undefined,
            true
        );
    } catch {
        // Already pending
    }

    return new Command({
        goto: "conversation",
        update: {
            messages: [
                new AIMessage(
                    `[Reviewer] Revision loop escalated to human review. Reason: ${reason}`
                ),
            ],
            currentAgent: "reviewer",
            phase: "review",
            iterationCount,
            reviewerGateState: defaultReviewerGateState(),
            hitlState: { pending: true, requestId: assessment.reviewId },
        },
    });
}

// ── Auto-Continuation Helpers ────────────────────────────

const SPECIALIST_AGENTS = new Set(["ideation", "planning", "execution", "reviewer"]);

function _resolveAgentForTask(assignedAgent: string): string {
    if (SPECIALIST_AGENTS.has(assignedAgent)) {
        return assignedAgent;
    }
    return "conversation";
}

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
            iterationCount: 0,
        },
    });
}

// ── Helpers ──────────────────────────────────────────────

function _extractAgentOutput(state: BaseClawStateType): string | null {
    const messages = state.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg._getType && msg._getType() === "ai") {
            return extractTextContent(msg.content);
        }
        if (
            msg.constructor?.name === "AIMessage" ||
            msg.constructor?.name === "AIMessageChunk"
        ) {
            return extractTextContent(msg.content);
        }
    }
    return null;
}

/** Reviewer Agent — wrapped with automatic memory + skill loading */
export const reviewerAgent = withContext(reviewerAgentCore, "reviewer");
