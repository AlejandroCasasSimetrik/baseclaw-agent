import type { TaskDefinition, AgentType } from "./types.js";

/**
 * TaskRegistry — Central registry for all tasks in the Base Claw system.
 *
 * Tasks are registered at startup (built-in) and can be added at runtime.
 * The registry supports querying by agent type and relevance scoring.
 * Mirrors the SkillRegistry pattern.
 */
export class TaskRegistry {
    private tasks: Map<string, TaskDefinition> = new Map();

    /**
     * Register a task in the registry.
     * Throws if a task with the same ID already exists.
     */
    register(task: TaskDefinition): void {
        if (this.tasks.has(task.id)) {
            throw new Error(
                `Task "${task.id}" is already registered. Use unregister() first to replace it.`
            );
        }
        this.tasks.set(task.id, task);
    }

    /**
     * Remove a task from the registry by ID.
     */
    unregister(taskId: string): boolean {
        return this.tasks.delete(taskId);
    }

    /**
     * Get a single task by ID.
     */
    getTask(id: string): TaskDefinition | undefined {
        return this.tasks.get(id);
    }

    /**
     * Get all registered tasks.
     */
    getAllTasks(): TaskDefinition[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Get all tasks available to a specific agent type.
     */
    getTasksForAgent(agentType: AgentType): TaskDefinition[] {
        return this.getAllTasks().filter((task) =>
            task.agentTypes.includes(agentType)
        );
    }

    /**
     * Get tasks relevant to the current context for a specific agent.
     * Uses each task's relevanceScorer to determine relevance.
     *
     * @param agentType - The agent type to filter by
     * @param taskContext - The current task description
     * @param threshold - Minimum relevance score (0.0–1.0), default 0.3
     * @returns Tasks sorted by relevance score (highest first)
     */
    getRelevantTasks(
        agentType: AgentType,
        taskContext: string,
        threshold: number = 0.3
    ): TaskDefinition[] {
        return this.getTasksForAgent(agentType)
            .filter(
                (task) =>
                    task.relevanceScorer(agentType, taskContext) >= threshold
            )
            .sort(
                (a, b) =>
                    b.relevanceScorer(agentType, taskContext) -
                    a.relevanceScorer(agentType, taskContext)
            );
    }

    /**
     * Build a task catalog prompt for an agent.
     * Used by the planning agent to know what tasks are available.
     */
    buildTaskCatalog(agentType: AgentType): string {
        const tasks = this.getTasksForAgent(agentType);
        if (tasks.length === 0) return "";

        const entries = tasks.map(
            (t) =>
                `- **${t.id}** — ${t.name}: ${t.description}` +
                (t.estimatedDuration ? ` (~${t.estimatedDuration})` : "") +
                (t.requiredSkills.length > 0
                    ? `\n  Skills: ${t.requiredSkills.join(", ")}`
                    : "") +
                (t.requiredTools.length > 0
                    ? `\n  Tools: ${t.requiredTools.join(", ")}`
                    : "")
        );

        return [
            "# Available Tasks",
            "Select from these tasks when building plans:\n",
            ...entries,
        ].join("\n");
    }

    /**
     * Get the number of registered tasks.
     */
    get size(): number {
        return this.tasks.size;
    }

    /**
     * Clear all tasks from the registry.
     */
    clear(): void {
        this.tasks.clear();
    }
}
