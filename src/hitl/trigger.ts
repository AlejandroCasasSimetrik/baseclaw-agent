/**
 * Level 9 — HITL Trigger
 *
 * The ONLY entry point for triggering Human-in-the-Loop.
 * Enforces ownership: only the Reviewer Agent can trigger HITL.
 * This is enforced at the code level, not by convention.
 */

import { v4 as uuidv4 } from "uuid";
import { traceable } from "langsmith/traceable";
import { HITLOwnershipError } from "./types.js";
import type { HITLRequest, HITLOption } from "./types.js";
import { getHITLManager } from "./pause-resume.js";

/**
 * Trigger HITL — creates a request and optionally pauses the system.
 *
 * @param reason - Why human input is needed
 * @param context - Data the user needs to make a decision
 * @param callerAgent - Which agent is calling this (MUST be "reviewer")
 * @param tenantId - Tenant scope
 * @param options - Optional structured choices
 * @param blocking - If true (default), pauses the system until user responds.
 *                   If false, sends a notification without pausing execution.
 * @returns The created HITLRequest
 * @throws HITLOwnershipError if callerAgent is not "reviewer"
 */
export const triggerHITL = traceable(
    async (
        reason: string,
        context: Record<string, unknown>,
        callerAgent: string,
        tenantId: string,
        options?: HITLOption[],
        blocking: boolean = true
    ): Promise<HITLRequest> => {
        // ── OWNERSHIP ENFORCEMENT ──────────────────────────
        // This is the only check that matters. No other code path
        // can set the HITL state to "pending".
        if (callerAgent !== "reviewer") {
            throw new HITLOwnershipError(callerAgent);
        }

        const manager = getHITLManager();

        // Don't allow double-trigger for blocking requests
        if (blocking && manager.isPending()) {
            throw new Error(
                "HITL is already pending. Cannot trigger another HITL request " +
                "until the current one is resolved."
            );
        }

        // Create the HITL request
        const request: HITLRequest = {
            id: uuidv4(),
            reason,
            context,
            options: options ?? null,
            blocking,
            triggeredBy: "reviewer", // Always — enforced above
            tenantId,
            createdAt: new Date().toISOString(),
            langsmithTraceId: `hitl-${Date.now()}-${uuidv4().slice(0, 8)}`,
        };

        if (blocking) {
            // Blocking: pause the system until user responds
            manager.pause(request);
            console.log(
                `🚦 HITL BLOCKING triggered by Reviewer Agent: "${reason.slice(0, 100)}"`
            );
        } else {
            // Non-blocking: notify the user but keep execution running
            manager.notify(request);
            console.log(
                `📢 HITL NOTIFICATION sent by Reviewer Agent: "${reason.slice(0, 100)}"`
            );
        }

        return request;
    },
    { name: "hitl.trigger", run_type: "chain" }
);
