import type { SkillDefinition } from "../types.js";

/**
 * Keyword-based relevance scorer factory.
 */
function keywordScorer(keywords: string[]): (agentType: string, taskContext: string) => number {
    return (_agentType: string, taskContext: string): number => {
        if (!taskContext) return 0.1;
        const lower = taskContext.toLowerCase();
        const matches = keywords.filter((kw) => lower.includes(kw));
        return Math.min(matches.length / Math.max(keywords.length * 0.4, 1), 1.0);
    };
}

// ── Reviewer Skills ──────────────────────────────────────────

export const outputValidation: SkillDefinition = {
    id: "reviewer.output-validation",
    name: "Output Validation",
    description:
        "Validates outputs against acceptance criteria, specifications, and quality standards.",
    agentTypes: ["reviewer"],
    systemPromptFragment: `You have the Output Validation skill active.

When validating outputs:
- **Completeness**: Does the output address all requirements?
- **Correctness**: Is the output factually and technically accurate?
- **Format compliance**: Does it match the expected format/schema?
- **Edge cases**: Does it handle boundary conditions and special cases?
- **Consistency**: Is it internally consistent and consistent with prior outputs?

For each validation check:
1. State the criterion being checked
2. Pass/Fail with evidence
3. If fail: specific issue and suggested fix
4. Overall validation status: PASS / PARTIAL / FAIL`,
    handler: async (context) => {
        return {
            output: `Validated output for: ${context.taskContext}`,
            metadata: { skillId: "reviewer.output-validation" },
        };
    },
    relevanceScorer: keywordScorer([
        "validate", "check", "verify", "correct", "test", "ensure",
        "complete", "accurate", "format", "criteria",
    ]),
    category: "reviewer",
};

export const qualityScoring: SkillDefinition = {
    id: "reviewer.quality-scoring",
    name: "Quality Scoring",
    description:
        "Scores quality across multiple dimensions using defined rubrics with consistent, fair evaluation.",
    agentTypes: ["reviewer"],
    systemPromptFragment: `You have the Quality Scoring skill active.

Score quality across these dimensions (each 1-10):
- **Completeness** (1-10): How fully does the output address the requirements?
- **Correctness** (1-10): How technically accurate is the output?
- **Clarity** (1-10): How clear and understandable is the output?
- **Efficiency** (1-10): Is the approach efficient and well-optimized?
- **Maintainability** (1-10): How easy will this be to maintain and extend?

Scoring guide:
- 9-10: Exceptional — exceeds expectations
- 7-8: Good — meets expectations with minor improvements possible
- 5-6: Acceptable — meets minimum requirements but needs improvement
- 3-4: Below standard — significant issues need addressing
- 1-2: Unacceptable — fundamental problems require rework

Provide: dimension scores, overall weighted score, and top 3 improvement priorities.`,
    handler: async (context) => {
        return {
            output: `Scored quality for: ${context.taskContext}`,
            metadata: { skillId: "reviewer.quality-scoring" },
        };
    },
    relevanceScorer: keywordScorer([
        "quality", "score", "rate", "evaluate", "grade", "measure",
        "rubric", "standard", "benchmark", "assess",
    ]),
    category: "reviewer",
};

export const feedbackSynthesis: SkillDefinition = {
    id: "reviewer.feedback-synthesis",
    name: "Feedback Synthesis",
    description:
        "Combines multiple feedback sources into prioritized, actionable improvement items.",
    agentTypes: ["reviewer"],
    systemPromptFragment: `You have the Feedback Synthesis skill active.

When synthesizing feedback:
- **Categorize**: Group feedback by type (bug, enhancement, style, architecture)
- **Deduplicate**: Merge similar feedback items into single actionable items
- **Prioritize**: Rank by impact × effort — high-impact low-effort first
- **Actionable format**: Each item must be a specific, actionable instruction
- **Context**: Include enough context that the executor can act without ambiguity

Output format:
### Critical (must fix)
1. [Actionable item with context]

### Important (should fix)
1. [Actionable item with context]

### Nice to have (could fix)
1. [Actionable item with context]`,
    handler: async (context) => {
        return {
            output: `Synthesized feedback for: ${context.taskContext}`,
            metadata: { skillId: "reviewer.feedback-synthesis" },
        };
    },
    relevanceScorer: keywordScorer([
        "feedback", "synthesize", "combine", "summarize", "consolidate",
        "improve", "suggestion", "recommendation", "revision",
    ]),
    category: "reviewer",
};

export const hitlTrigger: SkillDefinition = {
    id: "reviewer.hitl-trigger",
    name: "HITL Trigger",
    description:
        "Determines when human-in-the-loop intervention is needed based on risk, ambiguity, and quality thresholds.",
    agentTypes: ["reviewer"],
    systemPromptFragment: `You have the HITL Trigger skill active.

There are TWO types of HITL interactions:

## BLOCKING HITL (execution pauses until human responds)
**TRIGGER BLOCKING HITL when:**
- Ambiguous requirements that only a human can clarify (risk: wrong direction)
- High-risk actions with irreversible consequences (deleting data, sending emails, financial transactions)
- Quality score below 5/10 after two revision attempts
- Ethical or policy concerns that require human judgment
- Conflicting requirements that need stakeholder decision
- Security-sensitive operations (credential management, access control)

## NON-BLOCKING NOTIFICATION (execution continues, user is informed)
**SEND A NOTIFICATION when:**
- A task has been completed successfully
- Providing a status update or progress report
- Sharing review results that don't require a decision
- Informing the user of a routine decision you've already made

## DO NOT trigger any HITL for:
- Routine decisions within established patterns
- Low-risk, reversible actions
- Quality issues that can be fixed with clear feedback to the source agent

When triggering BLOCKING HITL:
1. State WHY human input is needed
2. Provide the specific question or decision to be made
3. Include relevant context and options
4. Suggest a default action if the human is unavailable

When sending a NOTIFICATION:
1. Be concise — summarize what was done and the outcome
2. Include the quality score if applicable
3. Do NOT ask questions — notifications are one-way`,
    handler: async (context) => {
        return {
            output: `Evaluated HITL trigger for: ${context.taskContext}`,
            metadata: { skillId: "reviewer.hitl-trigger" },
        };
    },
    relevanceScorer: keywordScorer([
        "human", "escalate", "approve", "review", "decision", "judgment",
        "sensitive", "irreversible", "risk", "ambiguous",
    ]),
    category: "reviewer",
};

/**
 * All reviewer built-in skills.
 */
export const reviewerSkills: SkillDefinition[] = [
    outputValidation,
    qualityScoring,
    feedbackSynthesis,
    hitlTrigger,
];
