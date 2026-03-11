import type { SkillDefinition, AgentType } from "./types.js";
import { inspectorBus } from "../inspector/event-bus.js";

/**
 * SkillRegistry — Central registry for all skills in the Base Claw system.
 *
 * Skills are registered at startup (built-in) and can be added at runtime (custom).
 * The registry supports querying by agent type and relevance scoring.
 *
 * Design note: the registry is designed to support sub-agent skill inheritance
 * (Level 7) via the getInheritedSkills() method.
 */
export class SkillRegistry {
    private skills: Map<string, SkillDefinition> = new Map();

    /**
     * Register a skill in the registry.
     * Throws if a skill with the same ID already exists.
     */
    register(skill: SkillDefinition): void {
        if (this.skills.has(skill.id)) {
            throw new Error(
                `Skill "${skill.id}" is already registered. Use unregister() first to replace it.`
            );
        }
        this.skills.set(skill.id, skill);

        // Notify inspector
        inspectorBus.emitSkillEvent("skill:registered", {
            skillId: skill.id,
            skillName: skill.name,
            agentTypes: skill.agentTypes,
            category: skill.category,
        });
    }

    /**
     * Remove a skill from the registry by ID.
     * Returns true if the skill was found and removed, false otherwise.
     */
    unregister(skillId: string): boolean {
        const removed = this.skills.delete(skillId);
        if (removed) {
            inspectorBus.emitSkillEvent("skill:unregistered", { skillId });
        }
        return removed;
    }

    /**
     * Get a single skill by ID.
     * Returns undefined if not found.
     */
    getSkill(id: string): SkillDefinition | undefined {
        return this.skills.get(id);
    }

    /**
     * Get all registered skills.
     */
    getAllSkills(): SkillDefinition[] {
        return Array.from(this.skills.values());
    }

    /**
     * Get all skills available to a specific agent type.
     * A skill is available if its agentTypes array includes the given type.
     */
    getSkillsForAgent(agentType: AgentType): SkillDefinition[] {
        return this.getAllSkills().filter((skill) =>
            skill.agentTypes.includes(agentType)
        );
    }

    /**
     * Get skills that are relevant to the current task for a specific agent.
     * Uses each skill's relevanceScorer to determine relevance.
     *
     * @param agentType - The agent type to filter by
     * @param taskContext - The current task description
     * @param threshold - Minimum relevance score (0.0–1.0), default 0.3
     * @returns Skills sorted by relevance score (highest first)
     */
    getRelevantSkills(
        agentType: AgentType,
        taskContext: string,
        threshold: number = 0.3
    ): SkillDefinition[] {
        return this.getSkillsForAgent(agentType)
            .filter(
                (skill) =>
                    skill.relevanceScorer(agentType, taskContext) >= threshold
            )
            .sort(
                (a, b) =>
                    b.relevanceScorer(agentType, taskContext) -
                    a.relevanceScorer(agentType, taskContext)
            );
    }

    /**
     * Get the number of registered skills.
     */
    get size(): number {
        return this.skills.size;
    }

    /**
     * Clear all skills from the registry.
     */
    clear(): void {
        this.skills.clear();
    }

    /**
     * Stub for Level 7 — Sub-agent skill inheritance.
     *
     * When a sub-agent is created, it should inherit skills from its parent.
     * This method returns the parent's skills that the child agent type can use.
     *
     * @param childAgentType - The sub-agent's type
     * @param parentAgentType - The parent agent's type
     * @returns Skills the child should inherit from the parent
     */
    getInheritedSkills(
        childAgentType: AgentType,
        parentAgentType: AgentType
    ): SkillDefinition[] {
        // For now, return skills that belong to the parent agent type
        // AND are also available to the child agent type.
        // Level 7 will add more sophisticated inheritance logic.
        return this.getSkillsForAgent(parentAgentType).filter((skill) =>
            skill.agentTypes.includes(childAgentType)
        );
    }
}
