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

// ── Conversation Skills ────────────────────────────────────────

export const contextSummarization: SkillDefinition = {
    id: "conversation.context-summarization",
    name: "Context Summarization",
    description:
        "Summarizes documents, conversations, and uploaded content into concise key points.",
    agentTypes: ["conversation", "reviewer"],
    systemPromptFragment: `You have the Context Summarization skill active.

When summarizing content:
- **Key Points**: Extract the 3-5 most important takeaways
- **Structure**: Organize information hierarchically (main ideas → supporting details)
- **Brevity**: Each point should be 1-2 sentences max
- **Completeness**: Don't miss critical information even if it's buried deep
- **Action Items**: Highlight any actionable items or next steps mentioned

Format summaries with bullet points and bold key terms for scannability.`,
    handler: async (context) => {
        return {
            output: `Summarized context for: ${context.taskContext}`,
            metadata: { skillId: "conversation.context-summarization" },
        };
    },
    relevanceScorer: keywordScorer([
        "summarize", "summary", "tldr", "key points", "overview",
        "document", "file", "content", "uploaded", "read",
        "tell me about", "what does", "what is", "explain",
    ]),
    category: "conversation",
};

export const codeExplanation: SkillDefinition = {
    id: "conversation.code-explanation",
    name: "Code Explanation",
    description:
        "Explains code snippets, architectures, and technical concepts in clear language.",
    agentTypes: ["conversation", "execution"],
    systemPromptFragment: `You have the Code Explanation skill active.

When explaining code or technical concepts:
- **What it does**: Plain-language summary of the code's purpose
- **How it works**: Step-by-step walkthrough of the logic
- **Key patterns**: Identify design patterns, data structures, and algorithms used
- **Dependencies**: Note what external libraries or systems the code relies on
- **Potential issues**: Flag any bugs, performance concerns, or edge cases

Adjust your explanation depth based on the user's apparent expertise level.
Use analogies for complex concepts.`,
    handler: async (context) => {
        return {
            output: `Explained code for: ${context.taskContext}`,
            metadata: { skillId: "conversation.code-explanation" },
        };
    },
    relevanceScorer: keywordScorer([
        "code", "function", "class", "api", "implementation", "bug",
        "error", "debug", "typescript", "javascript", "python",
        "how does", "explain", "architecture", "pattern", "design",
    ]),
    category: "conversation",
};

export const taskBreakdown: SkillDefinition = {
    id: "conversation.task-breakdown",
    name: "Task Breakdown",
    description:
        "Breaks down complex requests into structured, actionable steps with clear dependencies.",
    agentTypes: ["conversation", "planning"],
    systemPromptFragment: `You have the Task Breakdown skill active.

When the user presents a complex task or goal:
- **Decompose**: Break into 3-7 concrete, actionable steps
- **Order**: Arrange steps by dependency (which must come first?)
- **Estimate**: Give rough effort estimates when possible
- **Risks**: Flag steps that are uncertain or may change
- **Parallels**: Identify which steps can happen simultaneously
- **Checkpoints**: Suggest where to pause and validate before continuing

Present as a numbered list with clear, imperative verbs (Create, Configure, Test, Deploy).`,
    handler: async (context) => {
        return {
            output: `Broke down task: ${context.taskContext}`,
            metadata: { skillId: "conversation.task-breakdown" },
        };
    },
    relevanceScorer: keywordScorer([
        "build", "create", "make", "implement", "develop", "set up",
        "configure", "deploy", "plan", "steps", "how to", "help me",
        "want to", "need to", "should i", "project", "start",
    ]),
    category: "conversation",
};

export const dataAnalysis: SkillDefinition = {
    id: "conversation.data-analysis",
    name: "Data Analysis",
    description:
        "Analyzes data, extracts patterns, and presents findings with structured tables and insights.",
    agentTypes: ["conversation", "execution"],
    systemPromptFragment: `You have the Data Analysis skill active.

When analyzing data or information:
- **Patterns**: Identify trends, outliers, and recurring themes
- **Comparisons**: Structure data in tables for easy comparison
- **Metrics**: Calculate or estimate relevant statistics
- **Visualization**: Suggest appropriate chart types for the data
- **Insights**: Draw actionable conclusions from the analysis
- **Confidence**: Note where the data is incomplete or uncertain

Present findings in tables with clear headers and sorted by relevance.`,
    handler: async (context) => {
        return {
            output: `Analyzed data for: ${context.taskContext}`,
            metadata: { skillId: "conversation.data-analysis" },
        };
    },
    relevanceScorer: keywordScorer([
        "data", "analyze", "analysis", "compare", "statistics", "metrics",
        "numbers", "trend", "pattern", "table", "chart", "report",
        "performance", "benchmark", "measure", "count",
    ]),
    category: "conversation",
};

/**
 * All conversation built-in skills.
 */
export const conversationSkills: SkillDefinition[] = [
    contextSummarization,
    codeExplanation,
    taskBreakdown,
    dataAnalysis,
];
