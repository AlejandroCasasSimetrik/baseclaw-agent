import type { TaskDefinition } from "../types.js";

/**
 * Built-in planning tasks.
 * Available to the planning agent for structured plan creation.
 */
export const planningTasks: TaskDefinition[] = [
    {
        id: "planning.task-breakdown",
        name: "Create Task Breakdown",
        description:
            "Decompose a complex objective into small, actionable tasks with clear dependencies. Each task should be independently executable.",
        agentTypes: ["planning"],
        requiredSkills: [],
        requiredTools: [],
        estimatedDuration: "10m",
        category: "planning",
        systemPromptFragment: `When executing this task:
- Break the objective into 3-7 atomic tasks
- Each task should take no more than 1 hour
- Define clear inputs and outputs for each task
- Identify dependencies between tasks
- Order tasks for optimal parallel execution where possible`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "plan",
                "breakdown",
                "decompose",
                "steps",
                "tasks",
                "organize",
                "structure",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.4 + matches * 0.15, 1.0);
        },
    },
    {
        id: "planning.estimate-effort",
        name: "Estimate Effort",
        description:
            "Estimate time and resources required for each task in a plan. Considers complexity, dependencies, risks, and team capacity.",
        agentTypes: ["planning"],
        requiredSkills: [],
        requiredTools: [],
        estimatedDuration: "10m",
        category: "planning",
        systemPromptFragment: `When executing this task:
- For each task: estimate time (optimistic, likely, pessimistic)
- Identify resource requirements (people, tools, services)
- Flag tasks that could become bottlenecks
- Suggest parallel execution opportunities
- Provide total estimated duration with confidence range`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "estimate",
                "effort",
                "time",
                "cost",
                "resource",
                "how long",
                "timeline",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
    {
        id: "planning.identify-risks",
        name: "Identify Risks",
        description:
            "Analyze a plan for potential risks, blockers, and failure modes. Proposes mitigations and contingencies for each.",
        agentTypes: ["planning", "reviewer"],
        requiredSkills: [],
        requiredTools: [],
        estimatedDuration: "10m",
        category: "analysis",
        systemPromptFragment: `When executing this task:
- List potential risks (technical, timeline, resource, external)
- Rate each risk: probability (low/medium/high) × impact (low/medium/high)
- Propose mitigation strategies for high-impact risks
- Identify early warning signals
- Suggest contingency plans for critical risks`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "risk",
                "blocker",
                "danger",
                "fail",
                "concern",
                "issue",
                "problem",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
    {
        id: "planning.define-success-criteria",
        name: "Define Success Criteria",
        description:
            "Establish clear, measurable success criteria for each task and the overall plan. Defines what 'done' looks like.",
        agentTypes: ["planning"],
        requiredSkills: [],
        requiredTools: [],
        estimatedDuration: "5m",
        category: "planning",
        systemPromptFragment: `When executing this task:
- Define measurable acceptance criteria for each task
- Establish overall plan success metrics
- Differentiate between must-have and nice-to-have outcomes
- Specify how completion will be verified`,
        relevanceScorer: (_agentType, taskContext) => {
            const keywords = [
                "success",
                "criteria",
                "done",
                "complete",
                "acceptance",
                "metric",
                "goal",
            ];
            const lower = taskContext.toLowerCase();
            const matches = keywords.filter((k) => lower.includes(k)).length;
            return Math.min(0.2 + matches * 0.15, 1.0);
        },
    },
];
