/**
 * Level 8 — Sub-agent Inheritance
 *
 * Wires up the skill and MCP inheritance designed in Levels 2 and 6.
 *
 * Skills: Sub-agent receives a snapshot of the parent's loaded skills.
 *         It can dynamically load additional skills, but those don't
 *         propagate back to the parent.
 *
 * MCP: Sub-agent receives read-only access to parent's MCP servers.
 *      It can attach its own servers. On dissolve, only own servers
 *      are disconnected — parent connections remain.
 */

import type { SkillDefinition, AgentType } from "../skills/types.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { MCPAttachmentManager } from "../mcp/attachment.js";
import type { SpawnableAgentType } from "./types.js";

// ── Skill Inheritance ─────────────────────────────────────

/**
 * Snapshot the parent's currently loaded skills for a sub-agent.
 *
 * Returns the SkillDefinition objects for the given skill IDs.
 * Skills not found in the registry are silently skipped.
 *
 * @param parentSkillIds - IDs of skills currently loaded by the parent
 * @param registry - The global SkillRegistry
 * @returns Array of SkillDefinition objects for the sub-agent
 */
export function inheritSkills(
    parentSkillIds: string[],
    registry: SkillRegistry
): SkillDefinition[] {
    const inherited: SkillDefinition[] = [];

    for (const id of parentSkillIds) {
        const skill = registry.getSkill(id);
        if (skill) {
            inherited.push(skill);
        }
    }

    return inherited;
}

/**
 * Load additional skills for a sub-agent based on its task.
 *
 * This allows sub-agents to dynamically acquire skills beyond
 * what the parent had loaded. These skills do NOT propagate
 * back to the parent.
 *
 * @param agentType - The sub-agent's type (same as parent)
 * @param taskContext - The sub-agent's task description
 * @param registry - The global SkillRegistry
 * @param existingSkillIds - Already inherited skill IDs (to avoid duplicates)
 * @param threshold - Minimum relevance score (default 0.3)
 * @returns Additional skills loaded for this sub-agent
 */
export function loadAdditionalSkills(
    agentType: SpawnableAgentType,
    taskContext: string,
    registry: SkillRegistry,
    existingSkillIds: string[],
    threshold: number = 0.3
): SkillDefinition[] {
    const existingSet = new Set(existingSkillIds);
    const relevant = registry.getRelevantSkills(
        agentType as AgentType,
        taskContext,
        threshold
    );

    // Only return skills not already inherited
    return relevant.filter((skill) => !existingSet.has(skill.id));
}

// ── MCP Inheritance ───────────────────────────────────────

/**
 * Set up MCP server inheritance for a sub-agent.
 *
 * Delegates to the existing MCPAttachmentManager.inheritServers()
 * which copies parent servers as read-only parentServers on the child.
 *
 * @param parentAgentId - The parent agent's ID
 * @param childAgentId - The sub-agent's ID
 * @param attachmentManager - The shared MCPAttachmentManager
 */
export function inheritMCPServers(
    parentAgentId: string,
    childAgentId: string,
    attachmentManager: MCPAttachmentManager
): void {
    attachmentManager.inheritServers(childAgentId, parentAgentId);
}

/**
 * Clean up MCP connections on sub-agent dissolve.
 *
 * Disconnects only the sub-agent's own servers (ownServers).
 * Inherited parent connections remain active.
 *
 * @param childAgentId - The sub-agent's ID
 * @param ownServerIds - IDs of servers the sub-agent attached itself
 * @param attachmentManager - The shared MCPAttachmentManager
 */
export async function cleanupMCPInheritance(
    childAgentId: string,
    ownServerIds: string[],
    attachmentManager: MCPAttachmentManager
): Promise<void> {
    for (const serverId of ownServerIds) {
        try {
            await attachmentManager.detachServer(childAgentId, serverId);
        } catch {
            // Best-effort cleanup — don't block dissolve
        }
    }
}

/**
 * Get the list of inherited MCP server IDs from a parent agent.
 *
 * @param parentAgentId - The parent agent's ID
 * @param attachmentManager - The shared MCPAttachmentManager
 * @returns Array of server IDs from the parent's attached servers
 */
export function getParentMCPServerIds(
    parentAgentId: string,
    attachmentManager: MCPAttachmentManager
): string[] {
    const servers = attachmentManager.getAttachedServers(parentAgentId);
    return servers.map((s) => s.config.id);
}
