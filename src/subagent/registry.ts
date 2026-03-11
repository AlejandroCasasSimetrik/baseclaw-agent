/**
 * Level 8 — Sub-agent Registry
 *
 * Tracks all active sub-agents per parent agent.
 * Provides parent-child relationship management and system-level queries
 * for the Heartbeat (Level 9 preparation).
 */

import { EventEmitter } from "node:events";
import type { SubAgentState, SubAgentResult } from "./types.js";

/**
 * SubAgentRegistry — centralized tracking of all sub-agent instances.
 *
 * Singleton-like: one instance shared across the system.
 * Powers parent-child lookups and Heartbeat awareness.
 */
export class SubAgentRegistry extends EventEmitter {
    /** All sub-agents, keyed by sub-agent ID */
    private subAgents: Map<string, SubAgentState> = new Map();

    /** Parent → child IDs mapping */
    private parentToChildren: Map<string, Set<string>> = new Map();

    /** Resolve functions for sub-agents being awaited */
    private completionResolvers: Map<string, Array<(result: SubAgentResult | null) => void>> = new Map();

    // ── Registration ──────────────────────────────────────

    /**
     * Register a newly spawned sub-agent.
     */
    register(subAgent: SubAgentState): void {
        this.subAgents.set(subAgent.id, subAgent);

        // Track parent→child relationship
        let children = this.parentToChildren.get(subAgent.parentAgentId);
        if (!children) {
            children = new Set();
            this.parentToChildren.set(subAgent.parentAgentId, children);
        }
        children.add(subAgent.id);
    }

    /**
     * Update the state of a sub-agent.
     */
    updateState(subAgentId: string, updates: Partial<SubAgentState>): SubAgentState | undefined {
        const state = this.subAgents.get(subAgentId);
        if (!state) return undefined;

        Object.assign(state, updates);
        return state;
    }

    /**
     * Mark a sub-agent as completed with its result.
     * Fires the 'complete' event and resolves any awaiting promises.
     */
    markCompleted(subAgentId: string, result: SubAgentResult): void {
        const state = this.subAgents.get(subAgentId);
        if (!state) return;

        state.status = "completed";
        state.result = result;
        state.completedAt = new Date().toISOString();

        // Resolve waiting promises
        const resolvers = this.completionResolvers.get(subAgentId) || [];
        for (const resolve of resolvers) {
            resolve(result);
        }
        this.completionResolvers.delete(subAgentId);

        // Emit completion event (for onSubAgentComplete callbacks)
        this.emit("sub_agent_complete", state.parentAgentId, subAgentId, result);
    }

    /**
     * Mark a sub-agent as failed.
     */
    markFailed(subAgentId: string, error: string): void {
        const state = this.subAgents.get(subAgentId);
        if (!state) return;

        state.status = "error";
        state.error = error;
        state.completedAt = new Date().toISOString();

        // Resolve waiting promises with null
        const resolvers = this.completionResolvers.get(subAgentId) || [];
        for (const resolve of resolvers) {
            resolve(null);
        }
        this.completionResolvers.delete(subAgentId);

        this.emit("sub_agent_failed", state.parentAgentId, subAgentId, error);
    }

    /**
     * Mark a sub-agent as timed out.
     */
    markTimedOut(subAgentId: string): void {
        this.markFailed(subAgentId, "Execution timeout exceeded");
        const state = this.subAgents.get(subAgentId);
        if (state) {
            state.status = "timed_out";
        }
    }

    /**
     * Mark a sub-agent as cancelled.
     */
    markCancelled(subAgentId: string, reason: string): void {
        const state = this.subAgents.get(subAgentId);
        if (!state) return;

        state.status = "cancelled";
        state.error = reason;
        state.completedAt = new Date().toISOString();

        // Resolve waiting promises with null
        const resolvers = this.completionResolvers.get(subAgentId) || [];
        for (const resolve of resolvers) {
            resolve(null);
        }
        this.completionResolvers.delete(subAgentId);

        this.emit("sub_agent_cancelled", state.parentAgentId, subAgentId, reason);
    }

    // ── Removal ────────────────────────────────────────────

    /**
     * Remove a sub-agent from the registry (after dissolve).
     */
    remove(subAgentId: string): void {
        const state = this.subAgents.get(subAgentId);
        if (state) {
            const children = this.parentToChildren.get(state.parentAgentId);
            if (children) {
                children.delete(subAgentId);
                if (children.size === 0) {
                    this.parentToChildren.delete(state.parentAgentId);
                }
            }
        }
        this.subAgents.delete(subAgentId);
        this.completionResolvers.delete(subAgentId);
    }

    // ── Queries ────────────────────────────────────────────

    /**
     * Get a sub-agent's state by ID.
     */
    getSubAgent(subAgentId: string): SubAgentState | undefined {
        return this.subAgents.get(subAgentId);
    }

    /**
     * Get all active (pending or running) sub-agents for a specific parent.
     */
    getActiveSubAgents(parentAgentId: string): SubAgentState[] {
        const children = this.parentToChildren.get(parentAgentId);
        if (!children) return [];

        return [...children]
            .map((id) => this.subAgents.get(id))
            .filter(
                (sa): sa is SubAgentState =>
                    sa !== undefined &&
                    (sa.status === "pending" || sa.status === "running")
            );
    }

    /**
     * Get ALL sub-agents for a parent (any status).
     */
    getAllSubAgents(parentAgentId: string): SubAgentState[] {
        const children = this.parentToChildren.get(parentAgentId);
        if (!children) return [];

        return [...children]
            .map((id) => this.subAgents.get(id))
            .filter((sa): sa is SubAgentState => sa !== undefined);
    }

    /**
     * Get the result of a completed sub-agent.
     * Returns the result immediately if completed, undefined if still running.
     */
    getSubAgentResult(subAgentId: string): SubAgentResult | undefined {
        const state = this.subAgents.get(subAgentId);
        if (!state) return undefined;
        return state.result;
    }

    /**
     * Get the count of active (pending or running) sub-agents for a parent.
     */
    getActiveCount(parentAgentId: string): number {
        return this.getActiveSubAgents(parentAgentId).length;
    }

    // ── System-level Queries (Heartbeat Preparation) ──────

    /**
     * Get ALL currently running sub-agents across all parents.
     * Used by the Heartbeat (Level 9) to know if any execution is active.
     */
    getSystemWideActiveSubAgents(): SubAgentState[] {
        return [...this.subAgents.values()].filter(
            (sa) => sa.status === "pending" || sa.status === "running"
        );
    }

    /**
     * Quick check: are there any active sub-agents in the system?
     * Used by Heartbeat to decide if new tasks can be pulled.
     */
    hasAnyActive(): boolean {
        for (const sa of this.subAgents.values()) {
            if (sa.status === "pending" || sa.status === "running") {
                return true;
            }
        }
        return false;
    }

    // ── Awaiting ──────────────────────────────────────────

    /**
     * Wait for a specific sub-agent to complete.
     * Returns the result, or null if the sub-agent failed/was cancelled.
     * Includes a timeout to prevent indefinite blocking.
     */
    awaitSubAgent(
        subAgentId: string,
        timeoutMs: number = 600_000
    ): Promise<SubAgentResult | null> {
        const state = this.subAgents.get(subAgentId);
        if (!state) {
            return Promise.resolve(null);
        }

        // Already completed
        if (
            state.status === "completed" ||
            state.status === "error" ||
            state.status === "cancelled" ||
            state.status === "timed_out"
        ) {
            return Promise.resolve(state.result || null);
        }

        // Wait for completion
        return new Promise<SubAgentResult | null>((resolve) => {
            let resolvers = this.completionResolvers.get(subAgentId);
            if (!resolvers) {
                resolvers = [];
                this.completionResolvers.set(subAgentId, resolvers);
            }
            resolvers.push(resolve);

            // Safety timeout
            setTimeout(() => {
                resolve(null);
            }, timeoutMs);
        });
    }

    /**
     * Wait for all active sub-agents of a parent to complete.
     * Returns array of results (null entries for failed/cancelled sub-agents).
     */
    async awaitAllSubAgents(
        parentAgentId: string,
        timeoutMs: number = 600_000
    ): Promise<Array<SubAgentResult | null>> {
        const active = this.getActiveSubAgents(parentAgentId);
        if (active.length === 0) {
            // Check for completed ones
            const all = this.getAllSubAgents(parentAgentId);
            return all.map((sa) => sa.result || null);
        }

        const promises = active.map((sa) =>
            this.awaitSubAgent(sa.id, timeoutMs)
        );
        return Promise.all(promises);
    }

    /**
     * Register a callback to fire each time a sub-agent of a parent completes.
     * Returns an unsubscribe function.
     */
    onSubAgentComplete(
        parentAgentId: string,
        callback: (subAgentId: string, result: SubAgentResult) => void
    ): () => void {
        const handler = (
            pId: string,
            subId: string,
            result: SubAgentResult
        ) => {
            if (pId === parentAgentId) {
                callback(subId, result);
            }
        };

        this.on("sub_agent_complete", handler);

        // Return unsubscribe function
        return () => {
            this.off("sub_agent_complete", handler);
        };
    }

    // ── Utilities ──────────────────────────────────────────

    /**
     * Get total number of tracked sub-agents.
     */
    get size(): number {
        return this.subAgents.size;
    }

    /**
     * Clear all tracked sub-agents. Used in tests.
     */
    clear(): void {
        this.subAgents.clear();
        this.parentToChildren.clear();
        this.completionResolvers.clear();
        this.removeAllListeners();
    }
}

// ── Singleton ─────────────────────────────────────────────

let _instance: SubAgentRegistry | null = null;

/**
 * Get the shared SubAgentRegistry instance.
 */
export function getSubAgentRegistry(): SubAgentRegistry {
    if (!_instance) {
        _instance = new SubAgentRegistry();
    }
    return _instance;
}

/**
 * Reset the registry instance. Used in tests.
 */
export function resetSubAgentRegistry(): void {
    if (_instance) {
        _instance.clear();
    }
    _instance = null;
}
