/**
 * Level 8 — Sub-agent Lifecycle
 *
 * Implements the full lifecycle: spawn → execute → return → dissolve
 *
 * Each sub-agent:
 *   - Is of the SAME type as its parent
 *   - Gets a unique ID: `{parentAgentType}-sub-{uuid}`
 *   - Has isolated Working Memory
 *   - Inherits parent skills (snapshot) and MCP servers (read-only)
 *   - Cannot spawn its own sub-agents (max depth = 1)
 *   - Is traced in LangSmith as a child of the parent's trace
 */

import { v4 as uuidv4 } from "uuid";
import { traceable } from "langsmith/traceable";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createWorkingMemory } from "../memory/working-memory.js";
import { MemoryManager } from "../memory/manager.js";
import type {
    SubAgentConfig,
    SubAgentState,
    SubAgentResult,
    SubAgentResultMetadata,
    SpawnableAgentType,
} from "./types.js";
import {
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_ITERATIONS,
    buildSubAgentTraceMetadata,
} from "./types.js";
import { validateSpawnRequest, createTimeoutController, SubAgentTimeoutError } from "./safety.js";
import { getSubAgentRegistry } from "./registry.js";
import { SubAgentQueue } from "./coordinator.js";
import { inheritSkills, inheritMCPServers, cleanupMCPInheritance } from "./inheritance.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { MCPAttachmentManager } from "../mcp/attachment.js";

// ── Shared Instances ──────────────────────────────────────

let _skillRegistry: SkillRegistry | null = null;
let _mcpAttachmentManager: MCPAttachmentManager | null = null;
let _spawnQueue: SubAgentQueue | null = null;

/** Set shared instances for the lifecycle module */
export function configureSubAgentLifecycle(opts: {
    skillRegistry?: SkillRegistry;
    mcpAttachmentManager?: MCPAttachmentManager;
    concurrencyLimit?: number;
}): void {
    if (opts.skillRegistry) _skillRegistry = opts.skillRegistry;
    if (opts.mcpAttachmentManager) _mcpAttachmentManager = opts.mcpAttachmentManager;
    _spawnQueue = new SubAgentQueue(opts.concurrencyLimit ?? 5);
}

/** Get the spawn queue */
export function getSpawnQueue(): SubAgentQueue {
    if (!_spawnQueue) {
        _spawnQueue = new SubAgentQueue();
    }
    return _spawnQueue;
}

// ── System Prompts by Agent Type ──────────────────────────

const SUB_AGENT_PROMPTS: Record<SpawnableAgentType, string> = {
    ideation: `You are a Sub-Ideation Agent. You have been spawned to explore a specific angle of a larger ideation task. Focus deeply on your assigned topic. Return comprehensive findings. Be creative and thorough.`,
    planning: `You are a Sub-Planning Agent. You have been spawned to create a detailed plan for a specific component of a larger system. Focus on actionable, sequential steps with clear dependencies and success criteria.`,
    execution: `You are a Sub-Execution Agent. You have been spawned to handle a specific task step within a larger execution. Focus on completing your assigned task precisely and reporting results clearly.`,
    reviewer: `You are a Sub-Reviewer Agent. You have been spawned to perform a focused review on a specific aspect (e.g., code quality, security, performance). Provide structured, scored feedback with specific recommendations.`,
};

// ── LLM ──────────────────────────────────────────────────

function getSubAgentModel(agentType: SpawnableAgentType): ChatOpenAI {
    const temperatureMap: Record<SpawnableAgentType, number> = {
        ideation: 0.7,
        planning: 0.2,
        execution: 0.1,
        reviewer: 0.1,
    };
    return new ChatOpenAI({
        model: "gpt-4o-mini",
        temperature: temperatureMap[agentType],
    });
}

// ── Spawn ────────────────────────────────────────────────

/**
 * Spawn a sub-agent.
 *
 * Creates a new agent instance of the same type as the parent.
 * Validates safety rules. Sets up Working Memory, skill/MCP inheritance.
 * If the concurrency limit is reached, the spawn is queued.
 *
 * Returns the sub-agent's unique ID.
 *
 * Traced as a LangSmith span.
 */
export const spawnSubAgent = traceable(
    async (config: SubAgentConfig): Promise<string> => {
        const registry = getSubAgentRegistry();
        const queue = getSpawnQueue();

        // Validate spawn request
        const activeCount = registry.getActiveCount(config.parentAgentId);
        const validation = validateSpawnRequest(config, activeCount, queue.limit);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Check concurrency — queue if at limit
        if (queue.shouldQueue(activeCount)) {
            // Return queued promise — will resolve when a slot opens
            return queue.enqueue(config.parentAgentId, config);
        }

        return _doSpawn(config);
    },
    { name: "subagent.spawn" }
);

/**
 * Internal spawn implementation.
 */
async function _doSpawn(config: SubAgentConfig): Promise<string> {
    const registry = getSubAgentRegistry();

    // Generate unique ID
    const subAgentId = `${config.parentAgentType}-sub-${uuidv4()}`;
    const traceId = `trace-subagent-${Date.now()}-${uuidv4().slice(0, 8)}`;

    // Create isolated Working Memory
    const workingMemory = createWorkingMemory(
        `subtask-${subAgentId}`,
        config.tenantId,
        config.task
    );

    // Inherit skills
    let inheritedSkillIds = [...config.parentSkillIds];
    if (_skillRegistry) {
        const inherited = inheritSkills(config.parentSkillIds, _skillRegistry);
        inheritedSkillIds = inherited.map((s) => s.id);
    }

    // Inherit MCP servers
    let inheritedMCPServerIds: string[] = config.parentMCPServerIds || [];
    if (_mcpAttachmentManager) {
        inheritMCPServers(config.parentAgentId, subAgentId, _mcpAttachmentManager);
    }

    // Create sub-agent state
    const subAgentState: SubAgentState = {
        id: subAgentId,
        parentAgentId: config.parentAgentId,
        agentType: config.parentAgentType,
        status: "running",
        task: config.task,
        tenantId: config.tenantId,
        inheritedSkillIds,
        inheritedMCPServerIds,
        ownMCPServerIds: [],
        traceId,
        parentTraceId: config.parentTraceId,
        workingMemory,
        spawnedAt: new Date().toISOString(),
    };

    // Register in the registry
    registry.register(subAgentState);

    // Record spawn event to Episodic Memory (fire-and-forget)
    _recordSpawnEvent(config.tenantId, subAgentId, config).catch(() => { });

    return subAgentId;
}

// ── Execute ──────────────────────────────────────────────

/**
 * Execute a sub-agent's task.
 *
 * Runs the sub-agent with its task, respecting iteration limits and timeout.
 * The full execution is traced in LangSmith as a child of the parent's trace.
 *
 * Returns the SubAgentResult.
 */
export const executeSubAgent = traceable(
    async (subAgentId: string): Promise<SubAgentResult> => {
        const registry = getSubAgentRegistry();
        const state = registry.getSubAgent(subAgentId);

        if (!state) {
            throw new Error(`Sub-agent "${subAgentId}" not found in registry`);
        }

        if (state.status !== "running") {
            throw new Error(
                `Sub-agent "${subAgentId}" is in state "${state.status}", expected "running"`
            );
        }

        const startTime = Date.now();
        const timeoutMs = DEFAULT_TIMEOUT_MS;

        // Create timeout controller
        const { timeoutPromise, cancel: cancelTimeout } =
            createTimeoutController(subAgentId, timeoutMs);

        try {
            // Race between execution and timeout
            const result = await Promise.race([
                _executeTask(state),
                timeoutPromise,
            ]);

            cancelTimeout();

            // Mark completed in registry
            registry.markCompleted(subAgentId, result);

            // Drain queue — check if we can spawn the next queued sub-agent
            _drainQueue(state.parentAgentId);

            return result;
        } catch (error) {
            cancelTimeout();

            if (error instanceof SubAgentTimeoutError) {
                registry.markTimedOut(subAgentId);
                _drainQueue(state.parentAgentId);
                throw error;
            }

            const errorMsg =
                error instanceof Error ? error.message : String(error);
            registry.markFailed(subAgentId, errorMsg);
            _drainQueue(state.parentAgentId);
            throw error;
        }
    },
    { name: "subagent.execute" }
);

/**
 * Internal task execution.
 */
async function _executeTask(state: SubAgentState): Promise<SubAgentResult> {
    const startTime = Date.now();
    const model = getSubAgentModel(state.agentType);

    // Build system prompt
    const systemPrompt = SUB_AGENT_PROMPTS[state.agentType];
    const traceMetadata = buildSubAgentTraceMetadata(state);

    // Build skill context message
    let skillContext = "";
    if (state.inheritedSkillIds.length > 0 && _skillRegistry) {
        const skills = inheritSkills(state.inheritedSkillIds, _skillRegistry);
        skillContext = skills
            .map((s) => s.systemPromptFragment)
            .filter(Boolean)
            .join("\n\n");
    }

    const messages: any[] = [
        new SystemMessage(
            `${systemPrompt}\n\nYou are sub-agent ID: ${state.id}\nParent: ${state.parentAgentId}\n\n${skillContext ? `## Available Skills\n${skillContext}` : ""}`
        ),
        new HumanMessage(state.task),
    ];

    // Make the LLM call
    const response = await model.invoke(messages);
    const output = typeof response.content === "string" ? response.content : String(response.content);

    const durationMs = Date.now() - startTime;

    const resultMetadata: SubAgentResultMetadata = {
        subAgentId: state.id,
        agentType: state.agentType,
        durationMs,
        iterationsUsed: 1, // Single LLM call execution
        skillsUsed: state.inheritedSkillIds,
        mcpToolsCalled: [], // Will be populated when MCP tools are used
        traceId: state.traceId,
    };

    const result: SubAgentResult = {
        output,
        metadata: resultMetadata,
        executionSummary: `Sub-agent ${state.id} (${state.agentType}) completed task in ${durationMs}ms`,
    };

    return result;
}

// ── Dissolve ──────────────────────────────────────────────

/**
 * Dissolve a sub-agent after it has returned results.
 *
 * - Discards Working Memory
 * - Disconnects own MCP servers (preserving parent connections)
 * - Removes from registry
 * - Records dissolve event to Episodic Memory
 *
 * Traced as a LangSmith span.
 */
export const dissolveSubAgent = traceable(
    async (subAgentId: string): Promise<void> => {
        const registry = getSubAgentRegistry();
        const state = registry.getSubAgent(subAgentId);

        if (!state) {
            return; // Already dissolved or never existed
        }

        // Cleanup MCP own servers
        if (_mcpAttachmentManager && state.ownMCPServerIds.length > 0) {
            await cleanupMCPInheritance(
                subAgentId,
                state.ownMCPServerIds,
                _mcpAttachmentManager
            );
        }

        // Record dissolve event to Episodic Memory (fire-and-forget)
        _recordDissolveEvent(state).catch(() => { });

        // Discard Working Memory (nullify reference)
        registry.updateState(subAgentId, { workingMemory: null });

        // Remove from registry
        registry.remove(subAgentId);
    },
    { name: "subagent.dissolve" }
);

// ── Cancellation ─────────────────────────────────────────

/**
 * Cancel a running sub-agent.
 *
 * Marks it as cancelled and triggers dissolution.
 */
export async function cancelSubAgent(
    subAgentId: string,
    reason: string = "Cancelled by parent"
): Promise<void> {
    const registry = getSubAgentRegistry();
    const state = registry.getSubAgent(subAgentId);

    if (!state) return;

    if (state.status === "pending" || state.status === "running") {
        registry.markCancelled(subAgentId, reason);
        await dissolveSubAgent(subAgentId);
    }
}

/**
 * Cancel all active sub-agents for a parent (cascade cancellation).
 *
 * Called when a parent agent is cancelled or errors out.
 */
export async function cascadeCancelSubAgents(
    parentAgentId: string,
    reason: string = "Parent agent cancelled"
): Promise<void> {
    const registry = getSubAgentRegistry();
    const queue = getSpawnQueue();

    // Cancel queued spawns
    queue.cancelParentQueue(parentAgentId);

    // Cancel active sub-agents
    const active = registry.getActiveSubAgents(parentAgentId);
    await Promise.all(
        active.map((sa) => cancelSubAgent(sa.id, reason))
    );
}

// ── Queue Draining ──────────────────────────────────────

/**
 * Try to spawn the next queued sub-agent for a parent after a slot opens.
 */
function _drainQueue(parentAgentId: string): void {
    const registry = getSubAgentRegistry();
    const queue = getSpawnQueue();

    const activeCount = registry.getActiveCount(parentAgentId);
    if (activeCount >= queue.limit) return;

    const next = queue.dequeue(parentAgentId);
    if (!next) return;

    // Spawn and execute the queued request
    _doSpawn(next.config)
        .then((subAgentId) => {
            next.resolve(subAgentId);
            // Auto-execute then dissolve
            executeSubAgent(subAgentId)
                .then(() => dissolveSubAgent(subAgentId))
                .catch(() => dissolveSubAgent(subAgentId));
        })
        .catch((err) => next.reject(err));
}

// ── Episodic Memory Helpers ──────────────────────────────

async function _recordSpawnEvent(
    tenantId: string,
    subAgentId: string,
    config: SubAgentConfig
): Promise<void> {
    try {
        const mm = new MemoryManager(tenantId);
        // First create an episode to reference
        const episode = await mm.recordEpisode({
            agentType: config.parentAgentType,
            taskDescription: `Spawned sub-agent ${subAgentId}: ${config.task}`,
            outcome: "Sub-agent spawned successfully",
            durationMs: 0,
            langsmithTraceId: config.parentTraceId,
            metadata: {
                sub_agent_id: subAgentId,
                parent_agent_id: config.parentAgentId,
                event_type: "spawn",
            },
        });
    } catch {
        // Memory not available — continue without it
    }
}

async function _recordDissolveEvent(state: SubAgentState): Promise<void> {
    try {
        const mm = new MemoryManager(state.tenantId);
        const durationMs = state.completedAt
            ? new Date(state.completedAt).getTime() -
            new Date(state.spawnedAt).getTime()
            : 0;

        await mm.recordEpisode({
            agentType: state.agentType,
            taskDescription: `Sub-agent ${state.id} dissolved: ${state.task}`,
            outcome: state.result
                ? state.result.executionSummary
                : state.error || "Dissolved without result",
            durationMs,
            langsmithTraceId: state.traceId,
            metadata: {
                sub_agent_id: state.id,
                parent_agent_id: state.parentAgentId,
                event_type: "dissolve",
                status: state.status,
            },
        });
    } catch {
        // Memory not available — continue without it
    }
}

// ── Full Spawn+Execute+Dissolve Convenience ──────────────

/**
 * Spawn, execute, and dissolve a sub-agent in one call.
 *
 * This is the simplest way to use sub-agents.
 * Returns the result or throws on failure.
 */
export async function runSubAgent(
    config: SubAgentConfig
): Promise<SubAgentResult> {
    const subAgentId = await spawnSubAgent(config);
    try {
        const result = await executeSubAgent(subAgentId);
        await dissolveSubAgent(subAgentId);
        return result;
    } catch (error) {
        await dissolveSubAgent(subAgentId);
        throw error;
    }
}
