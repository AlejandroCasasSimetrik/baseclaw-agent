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

// ── Execution Skills ─────────────────────────────────────────

export const toolCalling: SkillDefinition = {
    id: "execution.tool-calling",
    name: "Tool Calling",
    description:
        "Invokes external tools and functions with proper parameter marshaling and response handling.",
    agentTypes: ["execution"],
    systemPromptFragment: `You have the Tool Calling skill active.

When invoking tools:
- **Parameter validation**: Verify all required parameters are present and correctly typed before calling
- **Error handling**: Wrap every tool call in try/catch with meaningful error messages
- **Retry logic**: On transient failures (network, rate limits), retry up to 3 times with exponential backoff
- **Result validation**: Verify the tool response matches expected schema before using
- **Logging**: Log the tool name, parameters (redacting secrets), and result status

Follow this pattern:
1. Validate inputs
2. Call tool with timeout
3. Validate response
4. Transform result for downstream use
5. Report success/failure with details`,
    handler: async (context) => {
        return {
            output: `Prepared tool calling strategy for: ${context.taskContext}`,
            metadata: { skillId: "execution.tool-calling" },
        };
    },
    relevanceScorer: keywordScorer([
        "tool", "call", "invoke", "function", "api", "use",
        "external", "service", "run", "execute",
    ]),
    category: "execution",
};

export const codeGeneration: SkillDefinition = {
    id: "execution.code-generation",
    name: "Code Generation",
    description:
        "Produces production-quality implementation code with proper error handling, typing, and documentation.",
    agentTypes: ["execution"],
    systemPromptFragment: `You have the Code Generation skill active.

When generating code:
- **Language idioms**: Follow idiomatic patterns for the target language
- **Type safety**: Use strong typing wherever possible (TypeScript strict mode, Python type hints)
- **Error handling**: Every external call and user input must have error handling
- **Documentation**: Add JSDoc/docstrings for public functions with parameter descriptions
- **Testing hooks**: Design code to be testable — inject dependencies, avoid global state
- **Edge cases**: Handle null/undefined, empty arrays, invalid inputs gracefully
- **Naming**: Use descriptive names that explain intent, not implementation

Structure output as:
1. Imports and dependencies
2. Type definitions
3. Implementation
4. Exports`,
    handler: async (context) => {
        return {
            output: `Generated code for: ${context.taskContext}`,
            metadata: { skillId: "execution.code-generation" },
        };
    },
    relevanceScorer: keywordScorer([
        "code", "implement", "write", "program", "function", "script",
        "build", "create", "develop", "generate",
    ]),
    category: "execution",
};

export const apiIntegration: SkillDefinition = {
    id: "execution.api-integration",
    name: "API Integration",
    description:
        "Connects to external APIs with proper authentication, error handling, and rate limit management.",
    agentTypes: ["execution"],
    systemPromptFragment: `You have the API Integration skill active.

When integrating with external APIs:
- **Authentication**: Support API keys, OAuth tokens, and service accounts
- **Base URL management**: Use environment variables, never hardcode endpoints
- **Request construction**: Build requests with proper headers, content types, and query params
- **Rate limiting**: Implement rate limit tracking and exponential backoff
- **Response parsing**: Parse responses defensively with schema validation
- **Error classification**: Distinguish between client errors (4xx), server errors (5xx), and network errors
- **Timeouts**: Set reasonable timeouts (10s for REST, 30s for long-running)

Produce integration code with:
1. Client configuration
2. Request builder functions
3. Response type definitions
4. Error handling middleware
5. Usage examples`,
    handler: async (context) => {
        return {
            output: `Prepared API integration for: ${context.taskContext}`,
            metadata: { skillId: "execution.api-integration" },
        };
    },
    relevanceScorer: keywordScorer([
        "api", "integrate", "connect", "endpoint", "service", "http",
        "rest", "request", "response", "webhook", "fetch",
    ]),
    category: "execution",
};

export const errorRecovery: SkillDefinition = {
    id: "execution.error-recovery",
    name: "Error Recovery",
    description:
        "Handles execution failures with structured retry logic, fallback strategies, and graceful degradation.",
    agentTypes: ["execution"],
    systemPromptFragment: `You have the Error Recovery skill active.

When handling errors during execution:
- **Classification**: Is this a transient error (retry) or permanent error (fallback)?
- **Retry strategy**: Exponential backoff with jitter, max 3 retries for transient errors
- **Fallback options**: Define at least one fallback for every critical operation
- **Graceful degradation**: If a feature fails, degrade gracefully rather than crashing
- **Error reporting**: Log structured error details (error type, context, attempt count, resolution)
- **Circuit breaker**: After 5 consecutive failures, stop retrying and report

Apply this decision tree:
1. Is the error transient? → Retry with backoff
2. Is there a fallback? → Use fallback with warning
3. Is partial completion possible? → Complete what you can, report what failed
4. None of the above? → Fail with clear error message and context`,
    handler: async (context) => {
        return {
            output: `Prepared error recovery strategy for: ${context.taskContext}`,
            metadata: { skillId: "execution.error-recovery" },
        };
    },
    relevanceScorer: keywordScorer([
        "error", "fail", "retry", "recover", "fallback", "handle",
        "exception", "crash", "bug", "fix", "debug",
    ]),
    category: "execution",
};

/**
 * All execution built-in skills.
 */
export const executionSkills: SkillDefinition[] = [
    toolCalling,
    codeGeneration,
    apiIntegration,
    errorRecovery,
];
