/**
 * Level 4 — Observability & Evaluation
 *
 * Barrel export for the entire observability subsystem.
 */

// ── Trace Configuration ────────────────────────────────────
export {
    initializeObservability,
    getLangSmithClient,
    resetLangSmithClient,
    getProjectName,
    getEnvironment,
} from "./trace-config.js";
export type { Environment } from "./trace-config.js";

// ── Trace Metadata ─────────────────────────────────────────
export {
    createTraceMetadata,
    traceSkillScoring,
    traceMemoryRead,
    traceMemoryWrite,
    traceInterAgentMessage,
} from "./trace-metadata.js";
export type { TraceMetadata } from "./trace-metadata.js";

// ── Sanitization ───────────────────────────────────────────
export {
    sanitizeString,
    sanitizeTraceData,
    containsSensitiveData,
    getRedactedMarker,
} from "./sanitizer.js";

// ── Dashboards ─────────────────────────────────────────────
export {
    ALL_DASHBOARDS,
    CONVERSATION_DASHBOARD,
    IDEATION_DASHBOARD,
    PLANNING_DASHBOARD,
    EXECUTION_DASHBOARD,
    REVIEWER_DASHBOARD,
    SYSTEM_OVERVIEW_DASHBOARD,
    getDashboardForAgent,
    setupDashboards,
} from "./dashboards.js";
export type { DashboardConfig, MetricDefinition } from "./dashboards.js";

// ── Evaluators ─────────────────────────────────────────────
export {
    routingAccuracyEvaluator,
    skillRelevanceEvaluator,
    memoryRetrievalQualityEvaluator,
    responseQualityEvaluator,
    ragRetrievalQualityEvaluator,
    mcpToolAccuracyEvaluator,
    subAgentEfficiencyEvaluator,
    EVALUATOR_TEMPLATES,
} from "./evaluators.js";
export type { EvaluatorResult, EvaluatorInput, EvaluatorKey } from "./evaluators.js";

// ── Datasets ───────────────────────────────────────────────
export {
    DATASET_CONFIGS,
    CONVERSATION_EXAMPLES,
    IDEATION_EXAMPLES,
    PLANNING_EXAMPLES,
    EXECUTION_EXAMPLES,
    REVIEWER_EXAMPLES,
    createAgentDatasets,
    getDatasetConfigForAgent,
} from "./datasets.js";
export type { DatasetExample, DatasetConfig } from "./datasets.js";

// ── Experiments ────────────────────────────────────────────
export { runExperiment } from "./experiments.js";
export type { ExperimentConfig, ExperimentResults } from "./experiments.js";

// ── Prompt Management ──────────────────────────────────────
export {
    PromptRegistry,
    getPromptRegistry,
    resetPromptRegistry,
    LOCAL_PROMPTS,
} from "./prompts.js";

// ── Alerting ───────────────────────────────────────────────
export {
    ALL_ALERT_RULES,
    ERROR_RATE_ALERT,
    LATENCY_P95_ALERT,
    COST_THRESHOLD_ALERT,
    HITL_TRIGGER_ALERT,
    getAlertDestination,
    getAlertConfig,
    fireAlert,
    setupAlerts,
} from "./alerting.js";
export type { AlertRule, AlertDestination, AlertConfig } from "./alerting.js";

// ── Bidirectional Navigation ───────────────────────────────
export {
    getTraceUrl,
    getEpisodesForTrace,
    getTraceUrlForEpisode,
} from "./navigation.js";
export type { EpisodeTraceLink } from "./navigation.js";
