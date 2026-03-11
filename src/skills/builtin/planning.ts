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

// ── Planning Skills ──────────────────────────────────────────

export const taskDecomposition: SkillDefinition = {
    id: "planning.task-decomposition",
    name: "Task Decomposition",
    description:
        "Breaks complex work into atomic, independently executable tasks with clear inputs and outputs.",
    agentTypes: ["planning"],
    systemPromptFragment: `You have the Task Decomposition skill active.

When decomposing tasks, follow these principles:
- **Atomic tasks**: Each task should be completable in one session by one person/agent
- **Clear inputs**: What does this task need before it can start?
- **Clear outputs**: What artifact or state change does this task produce?
- **Testable completion**: How do you know when this task is done?
- **Size targets**: Aim for tasks that take 1-4 hours of focused work
- **Numbering**: Use hierarchical numbering (1, 1.1, 1.1.1) for nested tasks

For each task, provide:
1. Task ID and title
2. Description (1-2 sentences)
3. Inputs required
4. Output/deliverable
5. Estimated effort
6. Done criteria`,
    handler: async (context) => {
        return {
            output: `Decomposed tasks for: ${context.taskContext}`,
            metadata: { skillId: "planning.task-decomposition" },
        };
    },
    relevanceScorer: keywordScorer([
        "decompose", "break down", "subtask", "step", "split",
        "task", "divide", "atomic", "breakdown", "work",
    ]),
    category: "planning",
};

export const dependencyMapping: SkillDefinition = {
    id: "planning.dependency-mapping",
    name: "Dependency Mapping",
    description:
        "Identifies dependencies between tasks, finds critical paths, and detects potential bottlenecks.",
    agentTypes: ["planning"],
    systemPromptFragment: `You have the Dependency Mapping skill active.

When mapping dependencies between tasks:
- **Hard dependencies**: Task B literally cannot start until Task A is done
- **Soft dependencies**: Task B is easier after Task A, but can start independently
- **Resource dependencies**: Tasks that compete for the same person/tool/environment
- **External dependencies**: Tasks blocked by things outside your control

Produce a dependency graph showing:
1. Which tasks can run in parallel (no dependencies)
2. The critical path (longest chain of hard dependencies)
3. Bottleneck tasks (many other tasks depend on them)
4. Risk points (tasks with external dependencies)

Flag any circular dependencies as errors.`,
    handler: async (context) => {
        return {
            output: `Mapped dependencies for: ${context.taskContext}`,
            metadata: { skillId: "planning.dependency-mapping" },
        };
    },
    relevanceScorer: keywordScorer([
        "dependency", "order", "sequence", "prerequisite", "depend", "block",
        "parallel", "critical path", "bottleneck", "graph",
    ]),
    category: "planning",
};

export const timelineEstimation: SkillDefinition = {
    id: "planning.timeline-estimation",
    name: "Timeline Estimation",
    description:
        "Estimates effort, duration, and deadlines with confidence intervals and buffer recommendations.",
    agentTypes: ["planning"],
    systemPromptFragment: `You have the Timeline Estimation skill active.

When estimating timelines:
- **Three-point estimation**: For each task, provide optimistic, likely, and pessimistic estimates
- **Confidence levels**: State your confidence (low/medium/high) in each estimate
- **Buffer rules**: Add 20% buffer for known unknowns, 40% for high-uncertainty tasks
- **Dependencies impact**: Account for handoff time between dependent tasks
- **Parallel work**: Calculate elapsed time (calendar), not just effort time

Present estimates as:
| Task | Optimistic | Likely | Pessimistic | Confidence |
|------|-----------|--------|-------------|------------|

Include a total timeline with the critical path duration and recommended buffer.`,
    handler: async (context) => {
        return {
            output: `Estimated timeline for: ${context.taskContext}`,
            metadata: { skillId: "planning.timeline-estimation" },
        };
    },
    relevanceScorer: keywordScorer([
        "timeline", "estimate", "deadline", "schedule", "duration", "time",
        "effort", "calendar", "sprint", "milestone", "date",
    ]),
    category: "planning",
};

export const riskAssessment: SkillDefinition = {
    id: "planning.risk-assessment",
    name: "Risk Assessment",
    description:
        "Identifies project risks, assesses likelihood and impact, and proposes mitigation strategies.",
    agentTypes: ["planning"],
    systemPromptFragment: `You have the Risk Assessment skill active.

When assessing risks, evaluate across these categories:
- **Technical risks**: Technology might not work as expected
- **Scope risks**: Requirements might change or expand
- **Resource risks**: Key people or tools might become unavailable
- **Integration risks**: Components might not work together
- **Timeline risks**: Tasks might take longer than estimated

For each risk:
1. **Description**: What could go wrong?
2. **Likelihood**: Low / Medium / High
3. **Impact**: Low / Medium / High / Critical
4. **Risk Score**: Likelihood × Impact
5. **Mitigation**: What can we do to prevent or reduce this risk?
6. **Contingency**: What's the backup plan if the risk materializes?

Sort risks by risk score (highest first). Flag any critical risks that need immediate attention.`,
    handler: async (context) => {
        return {
            output: `Assessed risks for: ${context.taskContext}`,
            metadata: { skillId: "planning.risk-assessment" },
        };
    },
    relevanceScorer: keywordScorer([
        "risk", "mitigation", "concern", "issue", "threat",
        "danger", "problem", "contingency", "fallback", "blocker",
    ]),
    category: "planning",
};

/**
 * All planning built-in skills.
 */
export const planningSkills: SkillDefinition[] = [
    taskDecomposition,
    dependencyMapping,
    timelineEstimation,
    riskAssessment,
];
