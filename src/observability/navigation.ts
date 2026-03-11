/**
 * Level 4 — Bidirectional Trace ↔ Episodic Navigation
 *
 * Utilities to navigate between LangSmith traces and
 * Episodic Memory entries. Enables:
 *   - See a trace → find the episode
 *   - See an episode → click through to the trace
 */

import { eq } from "drizzle-orm";
import { getDb } from "../memory/episodic/db.js";
import { episodes } from "../memory/episodic/schema.js";

// ── Trace URL Construction ──────────────────────────────────

/**
 * Build a direct LangSmith UI URL for a given trace ID.
 *
 * URL format: https://smith.langchain.com/o/{orgId}/projects/p/{projectId}/r/{traceId}
 *
 * If orgId is not set, returns a simplified URL that still works
 * for users logged into their default org.
 */
export function getTraceUrl(traceId: string): string {
    if (!traceId) {
        throw new Error("traceId is required");
    }

    const orgId = process.env.LANGSMITH_ORG_ID;
    const projectName = process.env.LANGCHAIN_PROJECT ?? "base-agent-dev";

    if (orgId) {
        return `https://smith.langchain.com/o/${orgId}/projects/p/${projectName}/r/${traceId}`;
    }

    // Simplified URL — works when user is logged into their default org
    return `https://smith.langchain.com/public/${traceId}/r`;
}

// ── Episode ↔ Trace Queries ─────────────────────────────────

export interface EpisodeTraceLink {
    episodeId: string;
    tenantId: string;
    agentType: string;
    taskDescription: string;
    outcome: string;
    langsmithTraceId: string;
    createdAt: Date;
    traceUrl: string;
}

/**
 * Get all Episodic Memory entries that are linked to a specific trace ID.
 *
 * Queries PostgreSQL for episodes with the matching langsmith_trace_id.
 */
export async function getEpisodesForTrace(traceId: string): Promise<EpisodeTraceLink[]> {
    if (!traceId) {
        throw new Error("traceId is required");
    }

    const db = getDb();
    const results = await db
        .select()
        .from(episodes)
        .where(eq(episodes.langsmithTraceId, traceId));

    return results.map((ep) => ({
        episodeId: ep.id,
        tenantId: ep.tenantId,
        agentType: ep.agentType,
        taskDescription: ep.taskDescription,
        outcome: ep.outcome,
        langsmithTraceId: ep.langsmithTraceId,
        createdAt: ep.createdAt,
        traceUrl: getTraceUrl(ep.langsmithTraceId),
    }));
}

/**
 * Get the trace URL for a specific episode by its ID and tenant.
 *
 * Looks up the episode, extracts its langsmith_trace_id, and
 * returns the LangSmith UI URL.
 */
export async function getTraceUrlForEpisode(
    tenantId: string,
    episodeId: string
): Promise<string | null> {
    const db = getDb();
    const results = await db
        .select({ langsmithTraceId: episodes.langsmithTraceId })
        .from(episodes)
        .where(
            eq(episodes.id, episodeId)
        )
        .limit(1);

    if (results.length === 0) return null;

    return getTraceUrl(results[0].langsmithTraceId);
}
