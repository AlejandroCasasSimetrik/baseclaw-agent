import type { TaskDefinition } from "../types.js";

/**
 * Built-in ideation tasks.
 * Available to the ideation agent for creative exploration.
 */
export const ideationTasks: TaskDefinition[] = [
    {
        id: "ideation.brainstorm",
        name: "Brainstorm Approaches",
        description:
            "Generate multiple creative approaches to solve a problem. Explores different angles, techniques, and strategies before converging on recommendations.",
        agentTypes: ["ideation"],
        requiredSkills: ["ideation.question-generation"],
        requiredTools: [],
        estimatedDuration: "10m",
        category: "creative",
        systemPromptFragment: `When executing this task:
- Generate at least 3 distinct approaches
- For each approach, list pros, cons, and estimated effort
- Rank approaches by feasibility and impact
- Ask clarifying questions if the problem space is ambiguous`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "brainstorm",
                "ideas",
                "approaches",
                "creative",
                "explore",
                "options",
                "alternatives",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.3 + matches * 0.15, 1.0);
        },
    },
    {
        id: "ideation.define-requirements",
        name: "Define Requirements",
        description:
            "Extract and structure requirements from a user request. Identifies functional requirements, non-functional requirements, constraints, and assumptions.",
        agentTypes: ["ideation", "planning"],
        requiredSkills: ["shared.context-synthesis"],
        requiredTools: [],
        estimatedDuration: "15m",
        category: "analysis",
        systemPromptFragment: `When executing this task:
- List functional requirements (what the system must do)
- List non-functional requirements (performance, security, UX)
- Identify constraints and assumptions
- Flag any ambiguous or missing requirements
- Ask targeted questions to fill gaps`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "requirements",
                "specs",
                "features",
                "needs",
                "scope",
                "define",
                "what should",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.3 + matches * 0.15, 1.0);
        },
    },
    {
        id: "ideation.stakeholder-analysis",
        name: "Stakeholder Analysis",
        description:
            "Identify stakeholders, their needs, priorities, and potential conflicts. Maps the landscape of people and systems affected by a project.",
        agentTypes: ["ideation"],
        requiredSkills: [],
        requiredTools: [],
        estimatedDuration: "10m",
        category: "analysis",
        systemPromptFragment: `When executing this task:
- Identify all stakeholders (users, teams, systems, external parties)
- For each stakeholder: their needs, priorities, and concerns
- Map potential conflicts between stakeholders
- Recommend prioritization strategy`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "stakeholder",
                "users",
                "audience",
                "team",
                "who",
                "impact",
                "affects",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
];
