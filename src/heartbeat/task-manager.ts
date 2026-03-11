/**
 * Level 9 — Continuous Task Manager
 *
 * CRUD operations for the persistent task queue backed by PostgreSQL.
 * All queries scoped by tenant_id for multi-tenancy.
 */

import { eq, and, asc, sql } from "drizzle-orm";
import { getDb } from "../memory/episodic/db.js";
import { continuousTasks } from "../memory/episodic/schema.js";
import type {
    ContinuousTask,
    ContinuousTaskInput,
    ContinuousTaskUpdate,
    TaskStatus,
} from "./types.js";

export class ContinuousTaskManager {
    constructor(public readonly tenantId: string) { }

    /**
     * Add a new task to the queue.
     */
    async addTask(input: ContinuousTaskInput): Promise<ContinuousTask> {
        const db = getDb();

        // Get current max priority for ordering
        const existing = await db
            .select({ maxPriority: sql<number>`COALESCE(MAX(${continuousTasks.priority}), 0)` })
            .from(continuousTasks)
            .where(eq(continuousTasks.tenantId, this.tenantId));

        const nextPriority = input.priority ?? (existing[0]?.maxPriority ?? 0) + 1;

        const [inserted] = await db
            .insert(continuousTasks)
            .values({
                tenantId: this.tenantId,
                title: input.title,
                description: input.description,
                priority: nextPriority,
                status: "queued",
                assignedAgent: input.assignedAgent ?? "auto",
            })
            .returning();

        return this.rowToTask(inserted);
    }

    /**
     * Remove a task from the queue.
     */
    async removeTask(taskId: string): Promise<boolean> {
        const db = getDb();
        const result = await db
            .delete(continuousTasks)
            .where(
                and(
                    eq(continuousTasks.id, taskId),
                    eq(continuousTasks.tenantId, this.tenantId)
                )
            )
            .returning();
        return result.length > 0;
    }

    /**
     * Reorder tasks by setting priorities based on the provided array order.
     * First ID in array = priority 1, second = priority 2, etc.
     */
    async reorderTasks(taskIds: string[]): Promise<void> {
        const db = getDb();
        for (let i = 0; i < taskIds.length; i++) {
            await db
                .update(continuousTasks)
                .set({
                    priority: i + 1,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(continuousTasks.id, taskIds[i]),
                        eq(continuousTasks.tenantId, this.tenantId)
                    )
                );
        }
    }

    /**
     * Get the highest-priority queued task.
     * Lower priority number = higher priority.
     */
    async getNextTask(): Promise<ContinuousTask | null> {
        const db = getDb();
        const rows = await db
            .select()
            .from(continuousTasks)
            .where(
                and(
                    eq(continuousTasks.tenantId, this.tenantId),
                    eq(continuousTasks.status, "queued")
                )
            )
            .orderBy(asc(continuousTasks.priority))
            .limit(1);

        if (rows.length === 0) return null;
        return this.rowToTask(rows[0]);
    }

    /**
     * Get all tasks with their status.
     */
    async getTaskList(): Promise<ContinuousTask[]> {
        const db = getDb();
        const rows = await db
            .select()
            .from(continuousTasks)
            .where(eq(continuousTasks.tenantId, this.tenantId))
            .orderBy(asc(continuousTasks.priority));

        return rows.map((r) => this.rowToTask(r));
    }

    /**
     * Update a task's description, priority, or assigned agent.
     */
    async updateTask(
        taskId: string,
        updates: ContinuousTaskUpdate
    ): Promise<ContinuousTask | null> {
        const db = getDb();
        const setValues: Record<string, unknown> = { updatedAt: new Date() };

        if (updates.title !== undefined) setValues.title = updates.title;
        if (updates.description !== undefined) setValues.description = updates.description;
        if (updates.priority !== undefined) setValues.priority = updates.priority;
        if (updates.assignedAgent !== undefined) setValues.assignedAgent = updates.assignedAgent;

        const [updated] = await db
            .update(continuousTasks)
            .set(setValues)
            .where(
                and(
                    eq(continuousTasks.id, taskId),
                    eq(continuousTasks.tenantId, this.tenantId)
                )
            )
            .returning();

        if (!updated) return null;
        return this.rowToTask(updated);
    }

    /**
     * Mark a task as in_progress.
     */
    async markInProgress(taskId: string): Promise<void> {
        const db = getDb();
        await db
            .update(continuousTasks)
            .set({
                status: "in_progress",
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(continuousTasks.id, taskId),
                    eq(continuousTasks.tenantId, this.tenantId)
                )
            );
    }

    /**
     * Mark a task as completed with its result and trace ID.
     */
    async markCompleted(
        taskId: string,
        result: string,
        langsmithTraceId: string
    ): Promise<void> {
        const db = getDb();
        await db
            .update(continuousTasks)
            .set({
                status: "completed",
                result,
                langsmithTraceId,
                completedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(continuousTasks.id, taskId),
                    eq(continuousTasks.tenantId, this.tenantId)
                )
            );
    }

    /**
     * Mark a task as failed with an error message and trace ID.
     */
    async markFailed(
        taskId: string,
        error: string,
        langsmithTraceId: string
    ): Promise<void> {
        const db = getDb();
        await db
            .update(continuousTasks)
            .set({
                status: "failed",
                result: `ERROR: ${error}`,
                langsmithTraceId,
                completedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(continuousTasks.id, taskId),
                    eq(continuousTasks.tenantId, this.tenantId)
                )
            );
    }

    /**
     * Get a single task by ID.
     */
    async getTask(taskId: string): Promise<ContinuousTask | null> {
        const db = getDb();
        const rows = await db
            .select()
            .from(continuousTasks)
            .where(
                and(
                    eq(continuousTasks.id, taskId),
                    eq(continuousTasks.tenantId, this.tenantId)
                )
            )
            .limit(1);

        if (rows.length === 0) return null;
        return this.rowToTask(rows[0]);
    }

    // ── Helpers ────────────────────────────────────────────

    private rowToTask(row: any): ContinuousTask {
        return {
            id: row.id,
            tenantId: row.tenantId,
            title: row.title,
            description: row.description,
            priority: row.priority,
            status: row.status as TaskStatus,
            assignedAgent: row.assignedAgent,
            result: row.result,
            langsmithTraceId: row.langsmithTraceId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            completedAt: row.completedAt,
        };
    }
}
