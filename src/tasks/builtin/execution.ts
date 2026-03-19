import type { TaskDefinition } from "../types.js";

/**
 * Built-in execution tasks — top-level grouped tasks.
 * Each task represents a broad capability, not a granular step.
 */
export const executionTasks: TaskDefinition[] = [
    {
        id: "execution.build",
        name: "Build & Implement",
        description:
            "Implement features, write code, create integrations, and handle the full development lifecycle — including writing tests, refactoring, and API integrations.",
        agentTypes: ["execution"],
        requiredSkills: ["execution.code-generation"],
        requiredTools: ["code_expert"],
        estimatedDuration: "30m",
        category: "development",
        systemPromptFragment: `When executing this task:
- Follow existing code patterns and conventions
- Write clean, documented code
- Create or update tests alongside implementation
- Handle error cases and edge cases explicitly
- Wire up integrations and map request/response schemas
- Refactor for quality when needed without changing behavior
- Log key operations for observability`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "implement", "build", "create", "code", "feature", "develop",
                "write", "test", "integrate", "api", "refactor", "endpoint",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.3 + matches * 0.1, 1.0);
        },
    },
    {
        id: "execution.deploy",
        name: "Deploy & Ship",
        description:
            "Deploy services and applications to target environments — build, configure, verify, and run post-deployment checks.",
        agentTypes: ["execution"],
        requiredSkills: [],
        requiredTools: [],
        estimatedDuration: "15m",
        category: "operations",
        systemPromptFragment: `When executing this task:
- Verify the build passes before deploying
- Check environment configuration
- Deploy to the target environment
- Run smoke tests post-deployment
- Document the deployment (version, timestamp, environment)`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "deploy", "release", "ship", "production", "staging",
                "publish", "launch", "environment",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.12, 1.0);
        },
    },
];
