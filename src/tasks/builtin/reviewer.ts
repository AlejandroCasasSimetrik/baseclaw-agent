import type { TaskDefinition } from "../types.js";

/**
 * Built-in reviewer tasks.
 * Available to the reviewer agent for quality assurance.
 */
export const reviewerTasks: TaskDefinition[] = [
    {
        id: "reviewer.code-review",
        name: "Code Review",
        description:
            "Review code changes for quality, correctness, security, and adherence to patterns. Provides actionable feedback.",
        agentTypes: ["reviewer"],
        requiredSkills: ["reviewer.quality-check"],
        requiredTools: [],
        estimatedDuration: "10m",
        category: "review",
        systemPromptFragment: `When executing this task:
- Check for correctness, edge cases, and error handling
- Verify adherence to existing code patterns
- Look for security vulnerabilities
- Assess readability and maintainability
- Provide specific, actionable feedback (not vague suggestions)`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "review",
                "code",
                "check",
                "quality",
                "pr",
                "changes",
                "diff",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.3 + matches * 0.15, 1.0);
        },
    },
    {
        id: "reviewer.plan-review",
        name: "Plan Review",
        description:
            "Review a structured plan for completeness, feasibility, and risk. Validates that tasks are well-defined and dependencies are correct.",
        agentTypes: ["reviewer"],
        requiredSkills: ["reviewer.quality-check"],
        requiredTools: [],
        estimatedDuration: "10m",
        category: "review",
        systemPromptFragment: `When executing this task:
- Verify all tasks have clear inputs and outputs
- Check dependency ordering is correct
- Assess feasibility of estimates
- Identify missing tasks or gaps
- Validate success criteria are measurable`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "review",
                "plan",
                "validate",
                "check",
                "approve",
                "feasib",
                "complete",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.3 + matches * 0.15, 1.0);
        },
    },
    {
        id: "reviewer.security-audit",
        name: "Security Audit",
        description:
            "Audit code or configuration for security vulnerabilities. Checks for common attack vectors, data exposure, and auth issues.",
        agentTypes: ["reviewer"],
        requiredSkills: [],
        requiredTools: [],
        estimatedDuration: "15m",
        category: "security",
        systemPromptFragment: `When executing this task:
- Check for injection vulnerabilities (SQL, XSS, command)
- Verify authentication and authorization patterns
- Look for data exposure risks (logs, error messages, API responses)
- Check secrets management (no hardcoded credentials)
- Assess dependency security (known vulnerabilities)`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "security",
                "audit",
                "vulnerab",
                "auth",
                "attack",
                "safe",
                "inject",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
    {
        id: "reviewer.performance-review",
        name: "Performance Review",
        description:
            "Review code or system design for performance issues. Identifies bottlenecks, unnecessary operations, and optimization opportunities.",
        agentTypes: ["reviewer"],
        requiredSkills: [],
        requiredTools: [],
        estimatedDuration: "10m",
        category: "review",
        systemPromptFragment: `When executing this task:
- Identify N+1 queries and unnecessary database calls
- Check for memory leaks or excessive allocations
- Look for blocking operations that could be async
- Assess algorithm complexity
- Suggest specific optimizations with expected impact`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "performance",
                "slow",
                "optimize",
                "bottleneck",
                "latency",
                "speed",
                "efficient",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
];
