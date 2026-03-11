/**
 * Level 3 — Episodic Memory Query Helpers
 *
 * All queries are scoped by tenantId for multi-tenancy.
 * Episodic Memory is append-only — no update or delete operations.
 *
 * Access control (read-only for Conversation Agent) is enforced
 * at the MemoryManager level, not here.
 */

import { eq, desc, ilike, or, and } from "drizzle-orm";
import { getDb } from "./db.js";
import {
    episodes,
    decisions,
    hitlEvents,
    fileUploads,
    feedbackLoops,
    subAgentEvents,
    mcpUsage,
    sttEvents,
    ttsEvents,
} from "./schema.js";
import type {
    EpisodeInput,
    DecisionInput,
    HitlEventInput,
    FileUploadInput,
    FeedbackLoopInput,
    SubAgentEventInput,
    McpUsageInput,
    STTEventInput,
    TTSEventInput,
} from "../types.js";

// ── Episode Operations ─────────────────────────────────────

/**
 * Append a new episode. Returns the inserted row.
 */
export async function insertEpisode(
    tenantId: string,
    episode: EpisodeInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(episodes)
        .values({
            tenantId,
            agentType: episode.agentType,
            taskDescription: episode.taskDescription,
            outcome: episode.outcome,
            durationMs: episode.durationMs,
            langsmithTraceId: episode.langsmithTraceId,
            metadata: episode.metadata ?? null,
        })
        .returning();
    return inserted;
}

/**
 * Get the most recent episodes for a tenant.
 */
export async function getRecentEpisodes(
    tenantId: string,
    limit: number = 20
) {
    const db = getDb();
    return db
        .select()
        .from(episodes)
        .where(eq(episodes.tenantId, tenantId))
        .orderBy(desc(episodes.createdAt))
        .limit(limit);
}

/**
 * Get episodes filtered by agent type.
 */
export async function getEpisodesByAgent(
    tenantId: string,
    agentType: string
) {
    const db = getDb();
    return db
        .select()
        .from(episodes)
        .where(
            and(
                eq(episodes.tenantId, tenantId),
                eq(episodes.agentType, agentType)
            )
        )
        .orderBy(desc(episodes.createdAt));
}

/**
 * Get episodes matching a task description (ILIKE search).
 */
export async function getEpisodesByTask(
    tenantId: string,
    taskDescription: string
) {
    const db = getDb();
    return db
        .select()
        .from(episodes)
        .where(
            and(
                eq(episodes.tenantId, tenantId),
                ilike(episodes.taskDescription, `%${taskDescription}%`)
            )
        )
        .orderBy(desc(episodes.createdAt));
}

/**
 * Full-text search across taskDescription and outcome.
 */
export async function searchEpisodes(tenantId: string, query: string) {
    const db = getDb();
    return db
        .select()
        .from(episodes)
        .where(
            and(
                eq(episodes.tenantId, tenantId),
                or(
                    ilike(episodes.taskDescription, `%${query}%`),
                    ilike(episodes.outcome, `%${query}%`)
                )
            )
        )
        .orderBy(desc(episodes.createdAt));
}

/**
 * Get a single episode by ID (scoped to tenant).
 */
export async function getEpisodeById(tenantId: string, id: string) {
    const db = getDb();
    const results = await db
        .select()
        .from(episodes)
        .where(
            and(eq(episodes.tenantId, tenantId), eq(episodes.id, id))
        )
        .limit(1);
    return results[0] ?? null;
}

// ── Supporting Table Inserts ───────────────────────────────

export async function insertDecision(
    tenantId: string,
    input: DecisionInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(decisions)
        .values({ tenantId, ...input })
        .returning();
    return inserted;
}

export async function insertHitlEvent(
    tenantId: string,
    input: HitlEventInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(hitlEvents)
        .values({ tenantId, ...input })
        .returning();
    return inserted;
}

export async function insertFileUpload(
    tenantId: string,
    input: FileUploadInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(fileUploads)
        .values({ tenantId, ...input })
        .returning();
    return inserted;
}

export async function insertFeedbackLoop(
    tenantId: string,
    input: FeedbackLoopInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(feedbackLoops)
        .values({ tenantId, ...input })
        .returning();
    return inserted;
}

export async function insertSubAgentEvent(
    tenantId: string,
    input: SubAgentEventInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(subAgentEvents)
        .values({ tenantId, ...input })
        .returning();
    return inserted;
}

/**
 * Get sub-agent events, optionally filtered by parent agent ID.
 * Level 8 — Sub-agent Spawning.
 */
export async function getSubAgentEvents(
    tenantId: string,
    parentAgentId?: string,
    limit: number = 20
) {
    const db = getDb();
    if (parentAgentId) {
        return db
            .select()
            .from(subAgentEvents)
            .where(
                and(
                    eq(subAgentEvents.tenantId, tenantId),
                    eq(subAgentEvents.parentAgentId, parentAgentId)
                )
            )
            .orderBy(desc(subAgentEvents.createdAt))
            .limit(limit);
    }
    return db
        .select()
        .from(subAgentEvents)
        .where(eq(subAgentEvents.tenantId, tenantId))
        .orderBy(desc(subAgentEvents.createdAt))
        .limit(limit);
}

export async function insertMcpUsage(
    tenantId: string,
    input: McpUsageInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(mcpUsage)
        .values({ tenantId, ...input })
        .returning();
    return inserted;
}

// ── STT Event Operations (Level 7) ────────────────────────

export async function insertSTTEvent(
    tenantId: string,
    input: STTEventInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(sttEvents)
        .values({ tenantId, ...input })
        .returning();
    return inserted;
}

export async function getSTTEvents(
    tenantId: string,
    limit: number = 20
) {
    const db = getDb();
    return db
        .select()
        .from(sttEvents)
        .where(eq(sttEvents.tenantId, tenantId))
        .orderBy(desc(sttEvents.createdAt))
        .limit(limit);
}

// ── TTS Event Operations (Level 7) ────────────────────────

export async function insertTTSEvent(
    tenantId: string,
    input: TTSEventInput
) {
    const db = getDb();
    const [inserted] = await db
        .insert(ttsEvents)
        .values({ tenantId, ...input })
        .returning();
    return inserted;
}

export async function getTTSEvents(
    tenantId: string,
    limit: number = 20
) {
    const db = getDb();
    return db
        .select()
        .from(ttsEvents)
        .where(eq(ttsEvents.tenantId, tenantId))
        .orderBy(desc(ttsEvents.createdAt))
        .limit(limit);
}
