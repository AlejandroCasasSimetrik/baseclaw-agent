import type { BaseClawStateType } from "../state.js";
import type { AgentType, SkillLoadResult } from "./types.js";
import { SkillLoader } from "./loader.js";
import { SkillRegistry } from "./registry.js";
import { Command } from "@langchain/langgraph";
import { SystemMessage } from "@langchain/core/messages";

/**
 * Creates a skill-aware wrapper around an agent function.
 *
 * The wrapper:
 * 1. Loads relevant skills for the current task (based on taskContext)
 * 2. Injects skill prompt fragments into the agent's context
 * 3. Calls the wrapped agent function
 * 4. Unloads skills after task completion
 * 5. Traces all skill operations for LangSmith visibility
 *
 * The existing agent functions remain COMPLETELY UNCHANGED.
 * The wrapper handles everything.
 *
 * @param agentType - Which agent type this wraps
 * @param agentFn - The original agent function
 * @param registry - The skill registry
 * @param loader - The skill loader
 */
export function createSkillAwareAgent(
    agentType: AgentType,
    agentFn: (state: BaseClawStateType) => Promise<Command>,
    registry: SkillRegistry,
    loader: SkillLoader
): (state: BaseClawStateType) => Promise<Command> {
    return async (state: BaseClawStateType): Promise<Command> => {
        // Load relevant skills for this task
        const { loadedSkills, loadResults, skillPrompt } =
            await loader.loadSkillsForTask(
                agentType,
                state.taskContext,
                registry
            );

        // Log skill loading decisions for tracing
        const loadedIds = loadedSkills.map((s) => s.id);
        const skippedCount = loadResults.filter((r) => !r.loaded).length;

        if (loadedSkills.length > 0) {
            console.log(
                `🧩 [${agentType}] Loaded ${loadedSkills.length} skills, skipped ${skippedCount}: [${loadedIds.join(", ")}]`
            );
        }

        // Inject skill prompt into state messages if skills were loaded
        let stateWithSkills = state;
        if (skillPrompt) {
            stateWithSkills = {
                ...state,
                messages: [
                    new SystemMessage(skillPrompt),
                    ...state.messages,
                ],
                activeSkills: loadedIds,
            };
        }

        // Call the original agent function
        const result = await agentFn(stateWithSkills);

        // Unload skills after task completion
        if (loadedIds.length > 0) {
            loader.unloadSkills(loadedIds);
        }

        // Attach activeSkills to the command update
        const update = (result as any).update || {};
        const commandConfig = {
            goto: (result as any).goto,
            update: {
                ...update,
                activeSkills: loadedIds,
            },
        };

        return new Command(commandConfig);
    };
}

/**
 * Format skill load results for trace metadata.
 */
export function formatSkillLoadTrace(results: SkillLoadResult[]): Record<string, unknown> {
    return {
        skillsConsidered: results.length,
        skillsLoaded: results.filter((r) => r.loaded).length,
        skillsSkipped: results.filter((r) => !r.loaded).length,
        details: results.map((r) => ({
            id: r.skillId,
            name: r.skillName,
            score: r.relevanceScore,
            loaded: r.loaded,
            reason: r.reason,
        })),
    };
}
