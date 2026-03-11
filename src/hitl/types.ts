/**
 * Level 9 — Human-in-the-Loop (HITL) Types
 *
 * Type definitions for the HITL system.
 * HITL is exclusively owned by the Reviewer Agent.
 */

// ── HITL State ─────────────────────────────────────────────

/**
 * Global HITL state.
 * - idle: no HITL in progress
 * - pending: Reviewer has triggered HITL, waiting for user response
 * - resolved: user has responded, response being routed
 */
export type HITLState = "idle" | "pending" | "resolved";

// ── HITL Request ───────────────────────────────────────────

/**
 * A structured choice option presented to the user.
 */
export interface HITLOption {
    label: string;
    value: string;
    description?: string;
}

/**
 * A HITL request created by the Reviewer Agent.
 */
export interface HITLRequest {
    /** Unique ID for this HITL request */
    id: string;
    /** Clear explanation of why human input is needed */
    reason: string;
    /** Relevant data the human needs to make a decision */
    context: Record<string, unknown>;
    /** Optional structured choices — or null for open-ended */
    options: HITLOption[] | null;
    /**
     * Whether this HITL blocks execution.
     * - true:  genuine blocker — the human must respond before work continues.
     *          Heartbeat enters "waiting" state.
     * - false: notification only — user is informed but execution continues.
     *          Heartbeat keeps running.
     */
    blocking: boolean;
    /** Must always be "reviewer" — enforced at code level */
    triggeredBy: string;
    /** Tenant scope */
    tenantId: string;
    /** When the HITL was triggered */
    createdAt: string;
    /** LangSmith trace ID for the HITL cycle */
    langsmithTraceId: string;
}

// ── HITL Response ──────────────────────────────────────────

/**
 * The user's response to a HITL request.
 */
export interface HITLResponse {
    /** ID of the HITL request being responded to */
    requestId: string;
    /** Free-text user input */
    userInput: string;
    /** If options were provided, the selected option value */
    selectedOption?: string;
    /** When the user responded */
    respondedAt: string;
    /** Which agent should receive the routed response */
    routeToAgent?: string;
}

// ── HITL Event (Episodic Memory) ───────────────────────────

/**
 * Full HITL event lifecycle record for episodic memory logging.
 */
export interface HITLEventRecord {
    /** Trigger reason */
    triggerReason: string;
    /** Always "reviewer" */
    triggeredBy: string;
    /** Snapshot of data presented to the user */
    contextSnapshot: Record<string, unknown>;
    /** What the user decided */
    userResponse: string | null;
    /** How the response was routed and what happened */
    resolution: string | null;
    /** How long the system was paused (ms) */
    pauseDuration: number | null;
    /** LangSmith trace ID for the full HITL cycle */
    langsmithTraceId: string;
    /** Tenant scope */
    tenantId: string;
}

// ── Error ──────────────────────────────────────────────────

/**
 * Error thrown when a non-Reviewer agent attempts to trigger HITL.
 */
export class HITLOwnershipError extends Error {
    constructor(callerAgent: string) {
        super(
            `HITL trigger rejected: only the Reviewer Agent can trigger HITL. ` +
            `Caller "${callerAgent}" is not authorized. ` +
            `This is enforced at the code level, not by convention.`
        );
        this.name = "HITLOwnershipError";
    }
}
