import type {
    TaskDefinition,
    TaskLoadResult,
    AgentType,
} from "./types.js";
import { TaskRegistry } from "./registry.js";
import { SkillRegistry } from "../skills/registry.js";
import { SkillLoader } from "../skills/loader.js";

/**
 * TaskLoader — Resolves skills and tools for a task before execution.
 *
 * When a task is about to execute, the loader:
 * 1. Looks up the task's requiredSkills in the SkillRegistry
 * 2. Loads those skills via the SkillLoader
 * 3. Returns the combined prompt and tool list for the agent
 */
export class TaskLoader {
    /**
     * Load tasks relevant to the current context for a specific agent.
     *
     * @param agentType - The agent requesting tasks
     * @param taskContext - Description of the current context
     * @param registry - The task registry to pull from
     * @param threshold - Minimum relevance score (default 0.3)
     * @returns Object with loaded tasks and load results for tracing
     */
    async loadTasksForContext(
        agentType: AgentType,
        taskContext: string,
        registry: TaskRegistry,
        threshold: number = 0.3
    ): Promise<{
        loadedTasks: TaskDefinition[];
        loadResults: TaskLoadResult[];
        taskPrompt: string;
    }> {
        const availableTasks = registry.getTasksForAgent(agentType);
        const loadResults: TaskLoadResult[] = [];
        const loadedTasks: TaskDefinition[] = [];

        for (const task of availableTasks) {
            const relevanceScore = task.relevanceScorer(agentType, taskContext);
            const shouldLoad = relevanceScore >= threshold;

            loadResults.push({
                taskId: task.id,
                taskName: task.name,
                relevanceScore,
                loaded: shouldLoad,
                reason: shouldLoad
                    ? `Relevance ${relevanceScore.toFixed(2)} >= threshold ${threshold}`
                    : `Relevance ${relevanceScore.toFixed(2)} < threshold ${threshold}`,
            });

            if (shouldLoad) {
                loadedTasks.push(task);
            }
        }

        const taskPrompt = this.buildTaskPrompt(loadedTasks);
        return { loadedTasks, loadResults, taskPrompt };
    }

    /**
     * Resolve the skills and tools required by a specific task.
     *
     * @param task - The task to resolve dependencies for
     * @param skillRegistry - The skill registry to look up required skills
     * @param skillLoader - The skill loader to load skills
     * @param agentType - The agent type executing the task
     * @returns Combined skill prompt and list of required tools
     */
    async resolveTaskDependencies(
        task: TaskDefinition,
        skillRegistry: SkillRegistry,
        skillLoader: SkillLoader,
        agentType: AgentType
    ): Promise<{
        skillPrompt: string;
        resolvedTools: string[];
        missingSkills: string[];
        missingTools: string[];
    }> {
        const missingSkills: string[] = [];
        const missingTools: string[] = [];

        // Check which required skills exist
        for (const skillId of task.requiredSkills) {
            if (!skillRegistry.getSkill(skillId)) {
                missingSkills.push(skillId);
            }
        }

        // Load the task's required skills (those that exist)
        const { skillPrompt } = await skillLoader.loadSkillsForTask(
            agentType,
            `Executing task: ${task.name} — ${task.description}`,
            skillRegistry,
            0.0 // Load all required skills regardless of relevance
        );

        // Tools are resolved by name — check availability later at execution
        const resolvedTools = [...task.requiredTools];

        return { skillPrompt, resolvedTools, missingSkills, missingTools };
    }

    /**
     * Build a combined system prompt fragment from loaded tasks.
     */
    buildTaskPrompt(loadedTasks: TaskDefinition[]): string {
        if (loadedTasks.length === 0) return "";

        const fragments = loadedTasks.map(
            (task) =>
                `## Task: ${task.name} (${task.id})\n${task.systemPromptFragment}`
        );

        return [
            "# Available Tasks",
            "The following tasks are loaded for this context. Use them to structure your work.\n",
            ...fragments,
        ].join("\n\n");
    }
}
