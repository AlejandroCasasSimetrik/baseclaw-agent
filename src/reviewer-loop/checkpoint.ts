/**
 * Level 10 — Mid-Execution Checkpoints
 *
 * Agents check in with the Reviewer periodically during long-running tasks.
 * The Reviewer assesses trajectory and alignment, returning:
 *   - "continue": proceed as planned
 *   - "adjust": change approach (guidance provided)
 *   - "pause": concern detected, triggers HITL
 *
 * Checkpoint frequency: configurable via REVIEW_CHECKPOINT_INTERVAL (.env)
 *
 * Checkpoints are lightweight — no full quality scoring, just trajectory check.
 * Traced as LangSmith child spans: reviewer.checkpoint
 */

import { traceable } from "langsmith/traceable";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { CheckpointRequest, CheckpointResponse, CheckpointVerdict } from "./types.js";
import { getReviewConfig } from "./types.js";

// ── LLM ──────────────────────────────────────────────────

let _checkpointModel: ChatOpenAI | null = null;

function getCheckpointModel(): ChatOpenAI {
    if (!_checkpointModel) {
        _checkpointModel = new ChatOpenAI({
            model: "gpt-4o-mini",
            temperature: 0.1,
        });
    }
    return _checkpointModel;
}

// ── Checkpoint Prompt ────────────────────────────────────

const CHECKPOINT_SYSTEM_PROMPT = `You are the Reviewer Agent's checkpoint engine. An agent is reporting its progress mid-execution. Assess whether the agent is on the right track.

You must decide:
- "continue" — the agent is on track, proceed as planned
- "adjust" — the agent should change its approach (provide specific guidance)
- "pause" — something is concerning enough to bring a human in the loop

Consider:
1. Is the progress aligned with the original task?
2. Are the planned next steps reasonable?
3. Are there any red flags or concerns?

RESPOND WITH VALID JSON ONLY. No markdown, no code fences:
{
  "verdict": "continue" | "adjust" | "pause",
  "guidance": "<string, only if verdict is adjust>",
  "reason": "<string, only if verdict is pause>"
}`;

// ── Core Checkpoint Function ─────────────────────────────

/**
 * Process a mid-execution checkpoint from an agent.
 *
 * Lightweight assessment — trajectory and alignment check only.
 * Does NOT perform full quality scoring.
 *
 * @param request - The agent's checkpoint data
 * @returns CheckpointResponse with verdict and optional guidance
 */
export const checkpointWithReviewer = traceable(
    async (request: CheckpointRequest): Promise<CheckpointResponse> => {
        const model = getCheckpointModel();

        const concerns =
            request.concerns.length > 0
                ? `\n\nAgent's concerns:\n${request.concerns.map((c) => `- ${c}`).join("\n")}`
                : "";

        const humanMessage = `Original Task: ${request.taskContext}

Agent: ${request.agentType}
Step: ${request.stepNumber}

Progress So Far:
${request.progressSummary}

Planned Next Steps:
${request.plannedNextSteps}${concerns}

Assess whether the agent should continue, adjust its approach, or pause for human review.`;

        const response = await model.invoke([
            new SystemMessage(CHECKPOINT_SYSTEM_PROMPT),
            new HumanMessage(humanMessage),
        ]);

        const responseText =
            typeof response.content === "string"
                ? response.content
                : String(response.content);

        // Parse the response
        let parsed: any;
        try {
            const cleaned = responseText
                .replace(/```json\s*/g, "")
                .replace(/```\s*/g, "")
                .trim();
            parsed = JSON.parse(cleaned);
        } catch {
            // Default to continue if parsing fails
            return {
                verdict: "continue",
                timestamp: new Date().toISOString(),
            };
        }

        const verdict = _validateVerdict(parsed.verdict);

        const checkpointResponse: CheckpointResponse = {
            verdict,
            timestamp: new Date().toISOString(),
        };

        if (verdict === "adjust" && parsed.guidance) {
            checkpointResponse.guidance = String(parsed.guidance);
        }
        if (verdict === "pause" && parsed.reason) {
            checkpointResponse.reason = String(parsed.reason);
        }

        return checkpointResponse;
    },
    { name: "reviewer.checkpoint", run_type: "chain" }
);

// ── Step Counter ─────────────────────────────────────────

/**
 * Check if a checkpoint should be triggered based on step count.
 *
 * @param currentStep - The current step number
 * @returns true if a checkpoint is due
 */
export function shouldCheckpoint(currentStep: number): boolean {
    const config = getReviewConfig();
    return currentStep > 0 && currentStep % config.checkpointInterval === 0;
}

// ── Helpers ──────────────────────────────────────────────

const VALID_VERDICTS: Set<string> = new Set(["continue", "adjust", "pause"]);

function _validateVerdict(verdict: string): CheckpointVerdict {
    return VALID_VERDICTS.has(verdict) ? (verdict as CheckpointVerdict) : "continue";
}
