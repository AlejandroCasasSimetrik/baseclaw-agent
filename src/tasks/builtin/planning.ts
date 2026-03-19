import type { TaskDefinition } from "../types.js";

/**
 * Built-in planning tasks — top-level grouped tasks.
 * Each task represents a broad capability, not a granular step.
 */
export const planningTasks: TaskDefinition[] = [
    {
        id: "planning.create-plan",
        name: "Plan & Structure",
        description:
            "Create a structured execution plan — decompose objectives into tasks, estimate effort, identify risks, and define success criteria. Covers the full planning lifecycle from breakdown to validation.",
        agentTypes: ["planning"],
        requiredSkills: ["shared.context-synthesis"],
        requiredTools: [],
        estimatedDuration: "15m",
        category: "planning",
        systemPromptFragment: `When executing this task:
- Break the objective into 3-7 actionable tasks
- Each task should have clear inputs and outputs
- Estimate time for each task (optimistic, likely, pessimistic)
- Identify dependencies and parallel execution opportunities
- Analyze risks: probability × impact, propose mitigations
- Define measurable success criteria for each task and the overall plan
- Flag potential blockers and suggest contingencies`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "plan", "breakdown", "decompose", "steps", "tasks", "organize",
                "structure", "estimate", "effort", "timeline", "risk", "criteria",
                "success", "goal", "schedule",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.4 + matches * 0.1, 1.0);
        },
    },
];
