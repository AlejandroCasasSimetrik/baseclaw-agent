import type { TaskDefinition } from "../types.js";

/**
 * Built-in reviewer tasks — top-level grouped tasks.
 * Each task represents a broad capability, not a granular step.
 */
export const reviewerTasks: TaskDefinition[] = [
    {
        id: "reviewer.review",
        name: "Review & Validate",
        description:
            "Review code, plans, or implementations for quality, security, and performance — covers code review, plan validation, security audits, and performance analysis.",
        agentTypes: ["reviewer"],
        requiredSkills: ["reviewer.quality-check"],
        requiredTools: [],
        estimatedDuration: "15m",
        category: "review",
        systemPromptFragment: `When executing this task:
- Check for correctness, edge cases, and error handling
- Verify adherence to existing code patterns
- Look for security vulnerabilities (injection, auth, data exposure)
- Assess performance (bottlenecks, unnecessary operations, complexity)
- Validate plan completeness, feasibility, and dependency ordering
- Provide specific, actionable feedback — not vague suggestions`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "review", "code", "check", "quality", "pr", "changes", "diff",
                "security", "audit", "performance", "validate", "plan",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.3 + matches * 0.1, 1.0);
        },
    },
];
