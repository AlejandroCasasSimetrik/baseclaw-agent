/**
 * Level 9 — System State Detector
 *
 * Detects the current system state for heartbeat decision-making:
 *   - Executing: any main agent or sub-agent is actively running
 *   - Idle: no agents running, no sub-agents running, no HITL pending
 *   - Waiting: a HITL request is pending
 */

import type { SubAgentRegistry } from "../subagent/registry.js";
import type { HITLManager } from "../hitl/pause-resume.js";
import type { SystemState } from "./types.js";

// ── Active Invocation Tracker ──────────────────────────────

/**
 * Tracks how many graph invocations are currently in-flight.
 * Increment when a graph.invoke() starts, decrement when it completes.
 * Thread-safe via simple counter (Node.js is single-threaded).
 */
let _activeInvocations = 0;

export function incrementActiveInvocations(): void {
    _activeInvocations++;
}

export function decrementActiveInvocations(): void {
    _activeInvocations = Math.max(0, _activeInvocations - 1);
}

export function getActiveInvocationCount(): number {
    return _activeInvocations;
}

export function resetActiveInvocations(): void {
    _activeInvocations = 0;
}

// ── State Detection ────────────────────────────────────────

/**
 * Detect the current system state.
 *
 * Priority order:
 *   1. If a blocking HITL is pending → "waiting" (highest priority)
 *      Non-blocking notifications do NOT cause waiting.
 *   2. If any main agent or sub-agent is active → "executing"
 *   3. Otherwise → "idle"
 */
export function detectSystemState(
    subAgentRegistry: SubAgentRegistry,
    hitlManager: HITLManager
): SystemState {
    // 1. Check blocking HITL first — waiting takes priority
    //    Non-blocking notifications (isBlocking() === false) are ignored
    if (hitlManager.isBlocking()) {
        return "waiting";
    }

    // 2. Check main agent activity
    if (_activeInvocations > 0) {
        return "executing";
    }

    // 3. Check sub-agent activity
    if (subAgentRegistry.hasAnyActive()) {
        return "executing";
    }

    // 4. Nothing active → idle
    return "idle";
}
