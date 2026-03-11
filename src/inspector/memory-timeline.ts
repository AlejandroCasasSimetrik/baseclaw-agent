/**
 * Level 2 — Memory Timeline Store
 *
 * In-memory ring buffer that records memory operations across all agents.
 * Fed by the inspector event bus. Queried by the timeline API and
 * forwarded to the UI via SSE.
 *
 * Each entry represents one memory operation (WM load/clear, episode write,
 * semantic query/write, HITL event, feedback loop).
 */

// ── Types ──────────────────────────────────────────────────

export type MemoryLayer = "working" | "episodic" | "semantic";

export interface TimelineEntry {
    id: string;
    timestamp: string;
    layer: MemoryLayer;
    agentType: string;
    type: string;           // event type e.g. "memory:working_loaded"
    summary: string;        // human-readable one-liner
    metadata: Record<string, unknown>;
}

// ── Ring Buffer Store ──────────────────────────────────────

const MAX_ENTRIES = 500;
const entries: TimelineEntry[] = [];
let idCounter = 0;

/**
 * Record a memory operation to the timeline.
 */
export function recordTimelineEvent(
    layer: MemoryLayer,
    agentType: string,
    type: string,
    summary: string,
    metadata: Record<string, unknown> = {}
): TimelineEntry {
    const entry: TimelineEntry = {
        id: `mem-${++idCounter}`,
        timestamp: new Date().toISOString(),
        layer,
        agentType,
        type,
        summary,
        metadata,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
    }
    return entry;
}

/**
 * Get timeline entries, optionally filtered by time range and layer.
 */
export function getTimelineEvents(opts?: {
    from?: string;
    to?: string;
    layers?: MemoryLayer[];
    agentType?: string;
    limit?: number;
}): TimelineEntry[] {
    let result = entries;

    if (opts?.from) {
        const fromDate = new Date(opts.from).getTime();
        result = result.filter(e => new Date(e.timestamp).getTime() >= fromDate);
    }
    if (opts?.to) {
        const toDate = new Date(opts.to).getTime();
        result = result.filter(e => new Date(e.timestamp).getTime() <= toDate);
    }
    if (opts?.layers && opts.layers.length > 0) {
        const layerSet = new Set(opts.layers);
        result = result.filter(e => layerSet.has(e.layer));
    }
    if (opts?.agentType) {
        result = result.filter(e => e.agentType === opts.agentType);
    }

    const limit = opts?.limit || 200;
    return result.slice(-limit);
}

/**
 * Clear all timeline entries (used in tests).
 */
export function clearTimeline(): void {
    entries.length = 0;
    idCounter = 0;
}

/**
 * Get total entry count.
 */
export function getTimelineCount(): number {
    return entries.length;
}
