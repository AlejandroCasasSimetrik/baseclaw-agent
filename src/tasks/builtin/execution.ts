import type { TaskDefinition } from "../types.js";

/**
 * Built-in execution tasks.
 * Available to the execution agent for implementation work.
 */
export const executionTasks: TaskDefinition[] = [
    {
        id: "execution.implement-feature",
        name: "Implement Feature",
        description:
            "Implement a specific feature or component based on requirements. Writes code, creates files, and wires up integrations.",
        agentTypes: ["execution"],
        requiredSkills: ["execution.code-generation"],
        requiredTools: ["code_expert"],
        estimatedDuration: "30m",
        category: "development",
        systemPromptFragment: `When executing this task:
- Follow existing code patterns and conventions
- Write clean, documented code
- Create or update tests alongside the implementation
- Handle error cases explicitly
- Log key operations for observability`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "implement",
                "build",
                "create",
                "code",
                "feature",
                "develop",
                "write",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.3 + matches * 0.15, 1.0);
        },
    },
    {
        id: "execution.write-tests",
        name: "Write Tests",
        description:
            "Create unit tests, integration tests, or end-to-end tests for existing code. Covers happy paths, edge cases, and error scenarios.",
        agentTypes: ["execution"],
        requiredSkills: ["execution.code-generation"],
        requiredTools: ["code_expert"],
        estimatedDuration: "20m",
        category: "development",
        systemPromptFragment: `When executing this task:
- Cover happy path, edge cases, and error cases
- Use existing test patterns and frameworks
- Mock external dependencies appropriately
- Aim for meaningful coverage, not just line count
- Name tests descriptively — what behavior is being tested`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "test",
                "spec",
                "coverage",
                "assert",
                "verify",
                "validate",
                "unit",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
    {
        id: "execution.api-integration",
        name: "API Integration",
        description:
            "Integrate with an external API. Handles authentication, request/response mapping, error handling, and rate limiting.",
        agentTypes: ["execution"],
        requiredSkills: [],
        requiredTools: ["http_request"],
        estimatedDuration: "20m",
        category: "integration",
        systemPromptFragment: `When executing this task:
- Set up authentication (API keys, OAuth, etc.)
- Map request/response schemas
- Handle HTTP errors and retries gracefully
- Implement rate limiting if needed
- Add logging for request/response debugging`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "api",
                "integrate",
                "endpoint",
                "http",
                "rest",
                "webhook",
                "external",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
    {
        id: "execution.refactor",
        name: "Refactor Code",
        description:
            "Refactor existing code to improve quality without changing behavior. Focuses on readability, performance, or structure.",
        agentTypes: ["execution"],
        requiredSkills: ["execution.code-generation"],
        requiredTools: ["code_expert"],
        estimatedDuration: "20m",
        category: "development",
        systemPromptFragment: `When executing this task:
- Preserve existing behavior — no functional changes
- Improve naming, structure, or performance
- Ensure tests still pass after refactoring
- Document the rationale for structural changes`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "refactor",
                "clean",
                "reorganize",
                "simplify",
                "restructure",
                "improve",
                "debt",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
    {
        id: "execution.deploy",
        name: "Deploy Service",
        description:
            "Deploy a service or application to a target environment. Handles build, configuration, and verification.",
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
                "deploy",
                "release",
                "ship",
                "production",
                "staging",
                "publish",
                "launch",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
];
