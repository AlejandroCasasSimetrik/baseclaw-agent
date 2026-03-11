/**
 * Level 10 — Feedback Generator
 *
 * Produces structured, actionable feedback when quality scoring
 * returns "needs_revision". Each issue has a dimension, severity,
 * description, and specific suggestion.
 *
 * Feedback is routed agent-to-agent (not through Conversation Agent).
 *
 * Traced as LangSmith spans: reviewer.gate.feedback
 */

import { traceable } from "langsmith/traceable";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getModel } from "../models/factory.js";
import type {
    QualityAssessment,
    StructuredFeedback,
    FeedbackIssue,
    QualityDimension,
    IssueSeverity,
} from "./types.js";
import type { AgentType } from "../skills/types.js";

// ── LLM ──────────────────────────────────────────────────

/** Model is resolved from centralized factory (configured via .env) */

// ── Feedback Prompt ──────────────────────────────────────

const FEEDBACK_SYSTEM_PROMPT = `You are the Reviewer Agent's feedback engine. Given a quality assessment of an agent's output, produce structured, actionable feedback.

For each quality dimension that scored below 80, identify specific issues. For each issue provide:
- dimension: which quality dimension (accuracy, completeness, clarity, relevance, safety, alignment)
- severity: "critical" (must fix), "major" (should fix), or "minor" (nice to fix)
- description: clear description of the issue found
- suggestion: specific, actionable suggestion for how to fix it

Also identify what's GOOD about the output (what to retain).

RESPOND WITH VALID JSON ONLY. No markdown, no code fences. Use this exact structure:
{
  "issues": [
    {
      "dimension": "<string>",
      "severity": "<critical|major|minor>",
      "description": "<string>",
      "suggestion": "<string>"
    }
  ],
  "retain": ["<string>", "<string>"]
}`;

// ── Core Feedback Generation ─────────────────────────────

/**
 * Generate structured feedback from a quality assessment.
 *
 * Called when the verdict is "needs_revision".
 * Produces specific, actionable issues and identifies good aspects to retain.
 *
 * @param assessment - The quality assessment that triggered revision
 * @param output - The agent's output text
 * @param taskContext - The original task/goal
 * @param maxRevisionsRemaining - How many more attempts allowed
 * @returns Structured feedback for the target agent
 */
export const generateFeedback = traceable(
    async (
        assessment: QualityAssessment,
        output: string,
        taskContext: string,
        maxRevisionsRemaining: number
    ): Promise<StructuredFeedback> => {
        const model = getModel("feedback");

        // Build the scoring context for the LLM
        const dimensionSummary = assessment.dimensions
            .map(
                (d) =>
                    `${d.dimension}: ${d.score}/100 — ${d.reasoning}`
            )
            .join("\n");

        const humanMessage = `Task/Goal: ${taskContext}

Agent: ${assessment.sourceAgent}

Agent Output:
${output.slice(0, 6000)}

Quality Scores:
${dimensionSummary}

Overall Score: ${assessment.overallScore}/100

Generate structured feedback focusing on dimensions that scored below 80. Be specific and actionable.`;

        const response = await model.invoke([
            new SystemMessage(FEEDBACK_SYSTEM_PROMPT),
            new HumanMessage(humanMessage),
        ]);

        const responseText =
            typeof response.content === "string"
                ? response.content
                : String(response.content);

        // Parse the JSON response
        let parsed: any;
        try {
            const cleaned = responseText
                .replace(/```json\s*/g, "")
                .replace(/```\s*/g, "")
                .trim();
            parsed = JSON.parse(cleaned);
        } catch {
            // Fallback: generate issues from the low-scoring dimensions
            return _buildFallbackFeedback(
                assessment,
                maxRevisionsRemaining
            );
        }

        // Validate and build issues
        const issues: FeedbackIssue[] = (parsed.issues || [])
            .filter((i: any) => i.dimension && i.description && i.suggestion)
            .map((i: any) => ({
                dimension: _validateDimension(i.dimension),
                severity: _validateSeverity(i.severity),
                description: String(i.description),
                suggestion: String(i.suggestion),
                reference: i.reference ? String(i.reference) : undefined,
            }));

        const retain: string[] = (parsed.retain || []).map(String);

        const feedback: StructuredFeedback = {
            targetAgent: assessment.sourceAgent,
            issues:
                issues.length > 0
                    ? issues
                    : _buildMinimalIssues(assessment),
            retain: retain.length > 0 ? retain : ["General structure and approach"],
            maxRevisionsRemaining,
            reviewId: assessment.reviewId,
            timestamp: new Date().toISOString(),
        };

        return feedback;
    },
    { name: "reviewer.gate.feedback", run_type: "chain" }
);

// ── Helpers ──────────────────────────────────────────────

const VALID_DIMENSIONS: Set<string> = new Set([
    "accuracy",
    "completeness",
    "clarity",
    "relevance",
    "safety",
    "alignment",
]);

const VALID_SEVERITIES: Set<string> = new Set([
    "critical",
    "major",
    "minor",
]);

function _validateDimension(dim: string): QualityDimension {
    return VALID_DIMENSIONS.has(dim)
        ? (dim as QualityDimension)
        : "completeness";
}

function _validateSeverity(sev: string): IssueSeverity {
    return VALID_SEVERITIES.has(sev) ? (sev as IssueSeverity) : "major";
}

/**
 * Build minimal issues from low-scoring dimensions when LLM parsing fails.
 */
function _buildMinimalIssues(
    assessment: QualityAssessment
): FeedbackIssue[] {
    return assessment.dimensions
        .filter((d) => d.score < 80)
        .map((d) => ({
            dimension: d.dimension,
            severity: (d.score < 40 ? "critical" : d.score < 60 ? "major" : "minor") as IssueSeverity,
            description: d.reasoning,
            suggestion: `Improve ${d.dimension} to meet the quality threshold.`,
        }));
}

/**
 * Build fallback feedback when LLM response can't be parsed.
 */
function _buildFallbackFeedback(
    assessment: QualityAssessment,
    maxRevisionsRemaining: number
): StructuredFeedback {
    return {
        targetAgent: assessment.sourceAgent,
        issues: _buildMinimalIssues(assessment),
        retain: ["General structure and approach"],
        maxRevisionsRemaining,
        reviewId: assessment.reviewId,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Format structured feedback as a human-readable string for injection
 * into an agent's context (via inter-agent messaging).
 */
export function formatFeedbackForAgent(feedback: StructuredFeedback): string {
    const issueLines = feedback.issues
        .map(
            (i, idx) =>
                `${idx + 1}. [${i.severity.toUpperCase()}] [${i.dimension}] ${i.description}\n   → Suggestion: ${i.suggestion}`
        )
        .join("\n");

    const retainLines = feedback.retain.map((r) => `  ✓ ${r}`).join("\n");

    return `## Reviewer Feedback (Review ID: ${feedback.reviewId})

### Issues to Address:
${issueLines}

### What to Keep:
${retainLines}

Revisions remaining: ${feedback.maxRevisionsRemaining}

Please revise your output addressing the issues above while retaining the good aspects.`;
}
