/**
 * Level 9 — HITL Pause/Resume Manager
 *
 * Singleton that manages the global HITL state.
 *
 * Two modes:
 *   - Blocking HITL: system pauses — no agents execute, heartbeat waits.
 *   - Non-blocking HITL (notification): user is informed, system continues.
 *
 * The heartbeat uses `isBlocking()` (not `isPending()`) to decide
 * whether to pause, so notifications never stall execution.
 */

import { EventEmitter } from "node:events";
import type { HITLRequest, HITLResponse, HITLState } from "./types.js";

export class HITLManager extends EventEmitter {
    private _state: HITLState = "idle";
    private _currentRequest: HITLRequest | null = null;
    private _pauseStartTime: number | null = null;
    private _notifications: HITLRequest[] = [];

    // ── State Queries ──────────────────────────────────────

    /** Is a HITL request currently pending? */
    isPending(): boolean {
        return this._state === "pending";
    }

    /** Get the current HITL state. */
    getState(): HITLState {
        return this._state;
    }

    /** Get the current pending HITL request, or null. */
    getCurrentRequest(): HITLRequest | null {
        return this._currentRequest;
    }

    /**
     * Is the current HITL request a blocking one?
     * Returns true ONLY when a blocking HITL is pending.
     * Non-blocking notifications return false.
     */
    isBlocking(): boolean {
        return this._state === "pending" && (this._currentRequest?.blocking === true);
    }

    /** Get pending non-blocking notifications. */
    getNotifications(): HITLRequest[] {
        return [...this._notifications];
    }

    /** Clear all non-blocking notifications (e.g., after user has seen them). */
    clearNotifications(): HITLRequest[] {
        const cleared = this._notifications;
        this._notifications = [];
        return cleared;
    }

    /** Get how long the system has been paused (ms), or null if not paused. */
    getPauseDuration(): number | null {
        if (this._pauseStartTime === null) return null;
        return Date.now() - this._pauseStartTime;
    }

    // ── Pause ──────────────────────────────────────────────

    /**
     * Pause the system for a blocking HITL request.
     * Sets state to "pending" and records the pause start time.
     * Heartbeat enters "waiting" state.
     */
    pause(request: HITLRequest): void {
        this._state = "pending";
        this._currentRequest = request;
        this._pauseStartTime = Date.now();
        this.emit("paused", request);
    }

    // ── Notify (Non-Blocking) ─────────────────────────────

    /**
     * Record a non-blocking notification.
     * Does NOT pause the system — heartbeat keeps running.
     * The notification is stored for the user to read at their convenience.
     */
    notify(request: HITLRequest): void {
        this._notifications.push(request);
        this.emit("notified", request);
    }

    // ── Resume ─────────────────────────────────────────────

    /**
     * Resume the system after a HITL response.
     * Clears the HITL state and returns the pause duration.
     */
    resume(response: HITLResponse): { pauseDurationMs: number } {
        const pauseDurationMs = this.getPauseDuration() ?? 0;

        this._state = "idle";
        this._currentRequest = null;
        this._pauseStartTime = null;

        this.emit("resumed", response, pauseDurationMs);

        return { pauseDurationMs };
    }

    // ── Reset ──────────────────────────────────────────────

    /**
     * Force-reset the HITL state. Used in tests.
     */
    reset(): void {
        this._state = "idle";
        this._currentRequest = null;
        this._pauseStartTime = null;
        this._notifications = [];
        this.removeAllListeners();
    }
}

// ── Singleton ─────────────────────────────────────────────

let _instance: HITLManager | null = null;

/**
 * Get the shared HITLManager instance.
 */
export function getHITLManager(): HITLManager {
    if (!_instance) {
        _instance = new HITLManager();
    }
    return _instance;
}

/**
 * Reset the HITLManager singleton. Used in tests.
 */
export function resetHITLManager(): void {
    if (_instance) {
        _instance.reset();
    }
    _instance = null;
}
