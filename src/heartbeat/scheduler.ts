/**
 * Level 9 — Heartbeat Scheduler
 *
 * The proactive execution loop that fires on a configurable interval.
 * When the system is idle, it pulls the next task from the Continuous
 * Task List and routes it to the appropriate agent.
 *
 * Features:
 *   - setInterval-based scheduling
 *   - PostgreSQL advisory lock prevents duplicate execution
 *   - Health monitoring (warns if > 2x interval since last fire)
 *   - All operations traced in LangSmith
 *   - Configurable via .env
 */

import { traceable } from "langsmith/traceable";
import { v4 as uuidv4 } from "uuid";
import { HumanMessage } from "@langchain/core/messages";
import { getSubAgentRegistry } from "../subagent/registry.js";
import { getHITLManager } from "../hitl/pause-resume.js";
import {
    detectSystemState,
    incrementActiveInvocations,
    decrementActiveInvocations,
} from "./state-detector.js";
import { ContinuousTaskManager } from "./task-manager.js";
import type {
    HeartbeatConfig,
    HeartbeatDecision,
    SystemState,
    HeartbeatAction,
} from "./types.js";
import { loadHeartbeatConfig } from "./types.js";

// ── Advisory Lock ──────────────────────────────────────────

/**
 * Acquire a PostgreSQL advisory lock to prevent duplicate heartbeat
 * execution in multi-instance deployments.
 *
 * Uses pg_try_advisory_lock with a fixed lock ID.
 */
async function tryAcquireHeartbeatLock(): Promise<boolean> {
    try {
        const { getDb } = await import("../memory/episodic/db.js");
        const db = getDb();
        // Advisory lock ID 900009 — unique to heartbeat
        const result = await (db as any).execute(
            `SELECT pg_try_advisory_lock(900009) as acquired`
        );
        return result?.rows?.[0]?.acquired === true;
    } catch {
        // If DB is unavailable, allow execution (single instance assumed)
        return true;
    }
}

async function releaseHeartbeatLock(): Promise<void> {
    try {
        const { getDb } = await import("../memory/episodic/db.js");
        const db = getDb();
        await (db as any).execute(`SELECT pg_advisory_unlock(900009)`);
    } catch {
        // Best-effort release
    }
}

// ── Scheduler ──────────────────────────────────────────────

export class HeartbeatScheduler {
    private _interval: ReturnType<typeof setInterval> | null = null;
    private _config: HeartbeatConfig;
    private _lastFireTime: number | null = null;
    private _healthCheckInterval: ReturnType<typeof setInterval> | null = null;
    private _running = false;
    private _fireCount = 0;
    private _tasksExecuted = 0;
    private _startedAt: number | null = null;

    /** Graph invoke function — injected to avoid circular imports */
    private _graphInvoke: ((input: any, config?: any) => Promise<any>) | null = null;

    /** Default tenant ID for heartbeat-triggered tasks */
    private _tenantId: string;

    constructor(tenantId: string = "default") {
        this._config = loadHeartbeatConfig();
        this._tenantId = tenantId;
    }

    // ── Configuration ──────────────────────────────────────

    /** Set the graph invoke function for task execution */
    setGraphInvoke(fn: (input: any, config?: any) => Promise<any>): void {
        this._graphInvoke = fn;
    }

    /** Update config (for testing or runtime changes) */
    setConfig(config: Partial<HeartbeatConfig>): void {
        Object.assign(this._config, config);
    }

    /** Get current config */
    getConfig(): HeartbeatConfig {
        return { ...this._config };
    }

    // ── Lifecycle ──────────────────────────────────────────

    /**
     * Start the heartbeat loop.
     */
    start(): void {
        if (!this._config.enabled) {
            console.log("💓 Heartbeat: disabled via config");
            return;
        }

        if (this._running) {
            console.warn("💓 Heartbeat: already running");
            return;
        }

        this._running = true;
        this._startedAt = Date.now();

        // Main interval
        this._interval = setInterval(async () => {
            try {
                await this.fire();
            } catch (error) {
                console.error(
                    "💓 Heartbeat fire error:",
                    error instanceof Error ? error.message : error
                );
            }
        }, this._config.intervalMs);

        // Health check — warn if heartbeat hasn't fired in 2x interval
        this._healthCheckInterval = setInterval(() => {
            this.checkHealth();
        }, this._config.intervalMs * 2);

        console.log(
            `💓 Heartbeat: started (interval=${this._config.intervalMs}ms, ` +
            `maxTaskDuration=${this._config.maxTaskDurationMs}ms)`
        );
    }

    /**
     * Stop the heartbeat loop.
     */
    async stop(): Promise<void> {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        if (this._healthCheckInterval) {
            clearInterval(this._healthCheckInterval);
            this._healthCheckInterval = null;
        }
        this._running = false;

        await releaseHeartbeatLock();
        console.log("💓 Heartbeat: stopped");
    }

    /**
     * Is the heartbeat currently running?
     */
    isRunning(): boolean {
        return this._running;
    }

    /** Get fire count since start */
    getFireCount(): number {
        return this._fireCount;
    }

    /** Get tasks executed count since start */
    getTasksExecuted(): number {
        return this._tasksExecuted;
    }

    /** Get last fire timestamp */
    getLastFireTime(): number | null {
        return this._lastFireTime;
    }

    /** Get started-at timestamp */
    getStartedAt(): number | null {
        return this._startedAt;
    }

    // ── Core Fire Logic ────────────────────────────────────

    /**
     * Execute a single heartbeat fire.
     * This is the core logic — also callable directly for testing.
     *
     * Traced in LangSmith as a "heartbeat.fire" span.
     */
    fire = traceable(
        async (): Promise<HeartbeatDecision> => {
            // Acquire advisory lock
            const lockAcquired = await tryAcquireHeartbeatLock();
            if (!lockAcquired) {
                const decision: HeartbeatDecision = {
                    state: "executing",
                    action: "continue",
                    reason: "Could not acquire heartbeat lock — another instance is running",
                    timestamp: new Date().toISOString(),
                };
                return decision;
            }

            try {
                this._lastFireTime = Date.now();
                this._fireCount++;

                // Detect system state
                const subAgentRegistry = getSubAgentRegistry();
                const hitlManager = getHITLManager();
                const state = detectSystemState(subAgentRegistry, hitlManager);

                // Decide action based on state
                let action: HeartbeatAction;
                let reason: string;
                let taskId: string | undefined;
                let taskTitle: string | undefined;
                let routedToAgent: string | undefined;

                switch (state) {
                    case "executing":
                        action = "continue";
                        reason = "System is actively executing — no interruption needed";
                        break;

                    case "waiting":
                        action = "wait";
                        reason = "HITL is pending — system paused waiting for user response";
                        break;

                    case "idle":
                        // Pull next task
                        const taskResult = await this.pullAndExecuteTask();
                        if (taskResult) {
                            action = "pull_task";
                            taskId = taskResult.taskId;
                            taskTitle = taskResult.taskTitle;
                            routedToAgent = taskResult.routedToAgent;
                            reason = `Pulled task "${taskResult.taskTitle}" and routed to ${taskResult.routedToAgent}`;
                        } else {
                            action = "continue";
                            reason = "System is idle but no tasks in queue";
                        }
                        break;
                }

                const decision: HeartbeatDecision = {
                    state,
                    action,
                    taskId,
                    taskTitle,
                    routedToAgent,
                    reason,
                    timestamp: new Date().toISOString(),
                };

                return decision;
            } finally {
                await releaseHeartbeatLock();
            }
        },
        { name: "heartbeat.fire", run_type: "chain" }
    );

    // ── Task Execution ─────────────────────────────────────

    /**
     * Pull the next task from the queue and execute it.
     * Returns task info if a task was executed, null if queue is empty.
     */
    private async pullAndExecuteTask(): Promise<{
        taskId: string;
        taskTitle: string;
        routedToAgent: string;
    } | null> {
        const taskManager = new ContinuousTaskManager(this._tenantId);
        const task = await taskManager.getNextTask();

        if (!task) return null;

        // Mark as in_progress
        await taskManager.markInProgress(task.id);

        // Determine which agent to route to
        const routedToAgent = task.assignedAgent === "auto"
            ? "conversation" // Auto routes through conversation for intent detection
            : task.assignedAgent;

        const traceId = `heartbeat-task-${Date.now()}-${uuidv4().slice(0, 8)}`;

        // Execute the task (fire-and-forget with timeout)
        this.executeTask(task.id, task.description, routedToAgent, traceId, taskManager)
            .catch((error) => {
                console.error(
                    `💓 Heartbeat task "${task.title}" failed:`,
                    error instanceof Error ? error.message : error
                );
            });

        return {
            taskId: task.id,
            taskTitle: task.title,
            routedToAgent,
        };
    }

    /**
     * Execute a task through the agent graph.
     * Runs with a timeout and handles success/failure marking.
     */
    private executeTask = traceable(
        async (
            taskId: string,
            description: string,
            _routedToAgent: string,
            traceId: string,
            taskManager: ContinuousTaskManager
        ): Promise<void> => {
            if (!this._graphInvoke) {
                await taskManager.markFailed(
                    taskId,
                    "No graph invoke function configured",
                    traceId
                );
                return;
            }

            // Wrap in timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(
                    () => reject(new Error("Heartbeat task timeout exceeded")),
                    this._config.maxTaskDurationMs
                );
            });

            try {
                incrementActiveInvocations();

                const resultPromise = this._graphInvoke(
                    {
                        messages: [new HumanMessage(description)],
                        tenantId: this._tenantId,
                    },
                    { recursionLimit: 50 }
                );

                const result = await Promise.race([resultPromise, timeoutPromise]);

                // Extract response from result
                const messages = result?.messages ?? [];
                const lastAiMessage = [...messages]
                    .reverse()
                    .find((m: any) => m._getType?.() === "ai");
                const responseText =
                    lastAiMessage?.content?.toString() ?? "Task completed";

                await taskManager.markCompleted(taskId, responseText, traceId);
                this._tasksExecuted++;
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                await taskManager.markFailed(taskId, errMsg, traceId);
            } finally {
                decrementActiveInvocations();
            }
        },
        { name: "heartbeat.executeTask", run_type: "chain" }
    );

    // ── Health Check ───────────────────────────────────────

    /**
     * Check if the heartbeat is healthy.
     * Warns if it hasn't fired in 2x the interval.
     */
    private checkHealth(): void {
        if (!this._lastFireTime) return;

        const elapsed = Date.now() - this._lastFireTime;
        const threshold = this._config.intervalMs * 2;

        if (elapsed > threshold) {
            console.warn(
                `⚠️ Heartbeat health: last fire was ${(elapsed / 1000).toFixed(0)}s ago ` +
                `(threshold: ${(threshold / 1000).toFixed(0)}s). ` +
                `The heartbeat may be stuck or crashed.`
            );
        }
    }
}

// ── Singleton ─────────────────────────────────────────────

let _instance: HeartbeatScheduler | null = null;

export function getHeartbeatScheduler(tenantId?: string): HeartbeatScheduler {
    if (!_instance) {
        _instance = new HeartbeatScheduler(tenantId);
    }
    return _instance;
}

export function resetHeartbeatScheduler(): void {
    if (_instance) {
        _instance.stop();
    }
    _instance = null;
}
