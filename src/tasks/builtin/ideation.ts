import type { TaskDefinition } from "../types.js";

/**
 * Built-in ideation tasks — top-level grouped tasks.
 * Each task represents a broad capability, not a granular step.
 */
export const ideationTasks: TaskDefinition[] = [
    {
        id: "ideation.explore",
        name: "Ideation & Exploration",
        description:
            "Explore a problem space creatively — brainstorm approaches, define requirements, analyze stakeholders, and generate structured options. Covers the full ideation lifecycle from understanding to recommendation.",
        agentTypes: ["ideation"],
        requiredSkills: ["ideation.question-generation", "shared.context-synthesis"],
        requiredTools: [],
        estimatedDuration: "15m",
        category: "ideation",
        systemPromptFragment: `When executing this task:
- Understand the problem space and user intent
- Generate multiple creative approaches (at least 3)
- Extract and structure requirements (functional + non-functional)
- Identify stakeholders, their needs, and potential conflicts
- For each approach, list pros, cons, and estimated effort
- Rank approaches by feasibility and impact
- Ask clarifying questions when the problem space is ambiguous`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "brainstorm", "ideas", "approaches", "creative", "explore",
                "options", "alternatives", "requirements", "specs", "features",
                "needs", "scope", "define", "stakeholder", "who", "audience",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.3 + matches * 0.1, 1.0);
        },
    },
];
