/**
 * LangSmith Tracing Configuration
 *
 * Level 1: Basic env-var tracing setup.
 * Level 4: Delegates to the observability module for enhanced tracing.
 *
 * This file is kept for backward compatibility — existing code and tests
 * that import `initializeTracing()` continue to work unchanged.
 */

import { initializeObservability } from "./observability/trace-config.js";

/**
 * Initialize LangSmith tracing.
 *
 * Level 4 enhancement: delegates to `initializeObservability()` which
 * adds environment-aware project naming (base-agent-dev/staging/prod).
 *
 * Backward-compatible: works the same as Level 1 from the caller's perspective.
 */
export function initializeTracing(): void {
    initializeObservability();
}
