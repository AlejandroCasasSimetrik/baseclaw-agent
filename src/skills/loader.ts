import type {
    AgentType,
    SkillDefinition,
    SkillLoadResult,
} from "./types.js";
import { SkillRegistry } from "./registry.js";
import { inspectorBus } from "../inspector/event-bus.js";

/**
 * SkillLoader — Dynamic skill loading and unloading with tracing.
 *
 * Skills are NOT always loaded into an agent's context. When an agent
 * activates for a task, the loader evaluates the task context and pulls
 * only relevant skills. After task completion, loaded skills are released.
 *
 * Every load/unload operation is traced for LangSmith visibility.
 */
export class SkillLoader {
    /**
     * Load skills relevant to the current task for a specific agent.
     *
     * Evaluates all skills available to the agent type, scores them
     * against the task context, and returns only those above the threshold.
     *
     * @param agentType - The agent requesting skills
     * @param taskContext - Description of the current task
     * @param registry - The skill registry to pull from
     * @param threshold - Minimum relevance score (default 0.3)
     * @returns Object with loaded skills, load results for tracing, and the combined prompt
     */
    async loadSkillsForTask(
        agentType: AgentType,
        taskContext: string,
        registry: SkillRegistry,
        threshold: number = 0.3
    ): Promise<{
        loadedSkills: SkillDefinition[];
        loadResults: SkillLoadResult[];
        skillPrompt: string;
    }> {
        const availableSkills = registry.getSkillsForAgent(agentType);
        const loadResults: SkillLoadResult[] = [];
        const loadedSkills: SkillDefinition[] = [];

        for (const skill of availableSkills) {
            const relevanceScore = skill.relevanceScorer(
                agentType,
                taskContext
            );
            const shouldLoad = relevanceScore >= threshold;

            loadResults.push({
                skillId: skill.id,
                skillName: skill.name,
                relevanceScore,
                loaded: shouldLoad,
                reason: shouldLoad
                    ? `Relevance ${relevanceScore.toFixed(2)} >= threshold ${threshold}`
                    : `Relevance ${relevanceScore.toFixed(2)} < threshold ${threshold}`,
            });

            if (shouldLoad) {
                loadedSkills.push(skill);
            }
        }

        const skillPrompt = this.buildSkillPrompt(loadedSkills);

        // Emit inspector events for each evaluated skill
        for (const result of loadResults) {
            inspectorBus.emitSkillEvent("skill:relevance_scored", {
                skillId: result.skillId,
                skillName: result.skillName,
                agentType,
                score: result.relevanceScore,
                loaded: result.loaded,
                reason: result.reason,
            });

            if (result.loaded) {
                inspectorBus.emitSkillEvent("skill:loaded", {
                    skillId: result.skillId,
                    skillName: result.skillName,
                    agentType,
                    relevanceScore: result.relevanceScore,
                });
            }
        }

        return { loadedSkills, loadResults, skillPrompt };
    }

    /**
     * Unload skills after task completion.
     * Returns the IDs of skills that were unloaded for tracing.
     */
    unloadSkills(activeSkillIds: string[], agentType: AgentType = "conversation" as AgentType, registry?: SkillRegistry): string[] {
        // Skills are stateless — "unloading" means removing from active context.
        // Return the IDs that were released for trace logging.
        for (const skillId of activeSkillIds) {
            // Resolve skillName from registry if available
            let skillName = skillId;
            if (registry) {
                const skill = registry.getSkillsForAgent(agentType).find(s => s.id === skillId);
                if (skill) skillName = skill.name;
            }
            inspectorBus.emitSkillEvent("skill:unloaded", {
                skillId,
                skillName,
                agentType,
            });
        }
        return [...activeSkillIds];
    }

    /**
     * Build a combined system prompt fragment from loaded skills.
     *
     * Each skill's systemPromptFragment is joined into a single block
     * that can be prepended to the agent's system prompt.
     */
    buildSkillPrompt(loadedSkills: SkillDefinition[]): string {
        if (loadedSkills.length === 0) {
            return "";
        }

        const fragments = loadedSkills.map(
            (skill) =>
                `## Skill: ${skill.name}\n${skill.systemPromptFragment}`
        );

        return [
            "# Active Skills",
            "The following skills are loaded for this task. Use them as appropriate.\n",
            ...fragments,
        ].join("\n\n");
    }
}
