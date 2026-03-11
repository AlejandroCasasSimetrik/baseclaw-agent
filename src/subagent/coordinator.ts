/**
 * Level 8 — Sub-agent Coordinator
 *
 * Manages parallel sub-agent execution with concurrency control.
 * Provides a queue for excess spawn requests and collection patterns
 * for gathering results from multiple sub-agents.
 */

import type { SubAgentConfig, SubAgentResult, SpawnableAgentType } from "./types.js";
import { DEFAULT_CONCURRENCY_LIMIT } from "./types.js";
import { SubAgentRegistry } from "./registry.js";
import { shouldQueue } from "./safety.js";

// ── Queued Spawn Request ──────────────────────────────────

interface QueuedSpawnRequest {
    config: SubAgentConfig;
    resolve: (subAgentId: string) => void;
    reject: (error: Error) => void;
}

/**
 * SubAgentQueue — manages concurrency for sub-agent spawning.
 *
 * When the concurrency limit is reached, additional spawn requests
 * are queued and executed as slots become available.
 */
export class SubAgentQueue {
    private queue: Map<string, QueuedSpawnRequest[]> = new Map();
    private concurrencyLimit: number;

    constructor(concurrencyLimit: number = DEFAULT_CONCURRENCY_LIMIT) {
        this.concurrencyLimit = concurrencyLimit;
    }

    /**
     * Check if a spawn should be queued for a given parent.
     */
    shouldQueue(activeCount: number): boolean {
        return shouldQueue(activeCount, this.concurrencyLimit);
    }

    /**
     * Enqueue a spawn request for a parent.
     * Returns a promise that resolves with the sub-agent ID when spawned.
     */
    enqueue(
        parentAgentId: string,
        config: SubAgentConfig
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            let parentQueue = this.queue.get(parentAgentId);
            if (!parentQueue) {
                parentQueue = [];
                this.queue.set(parentAgentId, parentQueue);
            }
            parentQueue.push({ config, resolve, reject });
        });
    }

    /**
     * Dequeue the next pending request for a parent (if any).
     */
    dequeue(parentAgentId: string): QueuedSpawnRequest | undefined {
        const parentQueue = this.queue.get(parentAgentId);
        if (!parentQueue || parentQueue.length === 0) {
            return undefined;
        }
        const next = parentQueue.shift();
        if (parentQueue.length === 0) {
            this.queue.delete(parentAgentId);
        }
        return next;
    }

    /**
     * Get the number of queued requests for a parent.
     */
    getQueueLength(parentAgentId: string): number {
        return this.queue.get(parentAgentId)?.length ?? 0;
    }

    /**
     * Get total queued requests across all parents.
     */
    getTotalQueueLength(): number {
        let total = 0;
        for (const q of this.queue.values()) {
            total += q.length;
        }
        return total;
    }

    /**
     * Cancel all queued requests for a parent (e.g., on parent cancellation).
     */
    cancelParentQueue(parentAgentId: string): void {
        const parentQueue = this.queue.get(parentAgentId);
        if (!parentQueue) return;

        for (const req of parentQueue) {
            req.reject(new Error(`Parent agent "${parentAgentId}" was cancelled`));
        }
        this.queue.delete(parentAgentId);
    }

    /** Get the concurrency limit */
    get limit(): number {
        return this.concurrencyLimit;
    }

    /** Update concurrency limit */
    setLimit(limit: number): void {
        this.concurrencyLimit = Math.max(1, limit);
    }

    /** Clear all queues. Used in tests. */
    clear(): void {
        // Reject all pending requests
        for (const parentQueue of this.queue.values()) {
            for (const req of parentQueue) {
                req.reject(new Error("Queue cleared"));
            }
        }
        this.queue.clear();
    }
}

// ── Result Collection Patterns ────────────────────────────

/**
 * Collect results from multiple sub-agents as they complete.
 *
 * Returns an async generator that yields results one at a time
 * as each sub-agent finishes.
 */
export async function* collectResultsAsCompleted(
    subAgentIds: string[],
    registry: SubAgentRegistry,
    timeoutMs: number = 600_000
): AsyncGenerator<{
    subAgentId: string;
    result: SubAgentResult | null;
}> {
    const pending = new Set(subAgentIds);

    for (const id of subAgentIds) {
        const state = registry.getSubAgent(id);
        if (
            state &&
            (state.status === "completed" ||
                state.status === "error" ||
                state.status === "cancelled" ||
                state.status === "timed_out")
        ) {
            pending.delete(id);
            yield { subAgentId: id, result: state.result || null };
        }
    }

    // Await remaining
    for (const id of pending) {
        const result = await registry.awaitSubAgent(id, timeoutMs);
        yield { subAgentId: id, result };
    }
}

/**
 * Collect all results at once, waiting for everything to complete.
 */
export async function collectAllResults(
    parentAgentId: string,
    registry: SubAgentRegistry,
    timeoutMs: number = 600_000
): Promise<Map<string, SubAgentResult | null>> {
    const results = new Map<string, SubAgentResult | null>();
    const allSubAgents = registry.getAllSubAgents(parentAgentId);

    const waitPromises = allSubAgents.map(async (sa) => {
        if (
            sa.status === "completed" ||
            sa.status === "error" ||
            sa.status === "cancelled" ||
            sa.status === "timed_out"
        ) {
            results.set(sa.id, sa.result || null);
        } else {
            const result = await registry.awaitSubAgent(sa.id, timeoutMs);
            results.set(sa.id, result);
        }
    });

    await Promise.all(waitPromises);
    return results;
}
