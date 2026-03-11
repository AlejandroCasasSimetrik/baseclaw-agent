/**
 * Level 4 — Alerting Configuration
 *
 * Defines alert rules and provides setup utilities.
 * Alert destinations configured via .env (webhook URL).
 *
 * Alert rules:
 *   - Error rate > 5% over 5 minutes
 *   - p95 latency > 10s for any agent
 *   - Cost per hour exceeds threshold
 *   - HITL trigger (wired for future Level 9)
 */

// ── Types ───────────────────────────────────────────────────

export interface AlertRule {
    /** Unique rule identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description */
    description: string;
    /** Metric being monitored */
    metric: string;
    /** Threshold value */
    threshold: number;
    /** Comparison operator */
    operator: ">" | "<" | ">=" | "<=" | "==";
    /** Time window in seconds */
    windowSeconds: number;
    /** Alert severity */
    severity: "info" | "warning" | "critical";
    /** Whether this alert is currently enabled */
    enabled: boolean;
}

export interface AlertDestination {
    /** Destination type */
    type: "webhook" | "slack" | "email";
    /** Destination URL or address */
    target: string;
    /** Optional headers for webhook */
    headers?: Record<string, string>;
}

export interface AlertConfig {
    rules: AlertRule[];
    destination: AlertDestination | null;
}

// ── Alert Rule Definitions ──────────────────────────────────

export const ERROR_RATE_ALERT: AlertRule = {
    id: "alert-error-rate",
    name: "High Error Rate",
    description: "Error rate exceeds 5% over 5 minutes",
    metric: "error_rate",
    threshold: 5,
    operator: ">",
    windowSeconds: 300,
    severity: "critical",
    enabled: true,
};

export const LATENCY_P95_ALERT: AlertRule = {
    id: "alert-latency-p95",
    name: "High p95 Latency",
    description: "p95 latency exceeds 10 seconds for any agent",
    metric: "latency_p95",
    threshold: 10000,
    operator: ">",
    windowSeconds: 300,
    severity: "warning",
    enabled: true,
};

export const COST_THRESHOLD_ALERT: AlertRule = {
    id: "alert-cost-threshold",
    name: "Cost Threshold Exceeded",
    description: "Cost per hour exceeds configurable threshold",
    metric: "cost_per_hour",
    threshold: parseFloat(process.env.LANGSMITH_COST_THRESHOLD ?? "10"),
    operator: ">",
    windowSeconds: 3600,
    severity: "warning",
    enabled: true,
};

export const HITL_TRIGGER_ALERT: AlertRule = {
    id: "alert-hitl-trigger",
    name: "HITL Triggered",
    description: "Human-in-the-loop trigger fired — immediate notification",
    metric: "hitl_trigger",
    threshold: 0,
    operator: ">",
    windowSeconds: 1,
    severity: "critical",
    enabled: true,
};

/**
 * All alert rules.
 */
export const ALL_ALERT_RULES: AlertRule[] = [
    ERROR_RATE_ALERT,
    LATENCY_P95_ALERT,
    COST_THRESHOLD_ALERT,
    HITL_TRIGGER_ALERT,
];

// ── Alert Destination ───────────────────────────────────────

/**
 * Get the alert destination from environment variables.
 * Returns null if no destination is configured.
 */
export function getAlertDestination(): AlertDestination | null {
    const webhookUrl = process.env.LANGSMITH_ALERT_WEBHOOK_URL;
    if (webhookUrl) {
        return {
            type: "webhook",
            target: webhookUrl,
            headers: {
                "Content-Type": "application/json",
                "X-Source": "BaseClaw",
            },
        };
    }

    return null;
}

/**
 * Get the full alert configuration.
 */
export function getAlertConfig(): AlertConfig {
    return {
        rules: ALL_ALERT_RULES,
        destination: getAlertDestination(),
    };
}

/**
 * Fire an alert to the configured destination.
 *
 * Used for programmatic alert triggering (e.g., HITL events).
 */
export async function fireAlert(
    rule: AlertRule,
    details: {
        metricValue: number;
        traceId?: string;
        agentType?: string;
        message?: string;
    }
): Promise<boolean> {
    const destination = getAlertDestination();
    if (!destination) {
        console.warn(`⚠️ Alert "${rule.name}" fired but no destination configured`);
        return false;
    }

    const payload = {
        alert_rule: rule.name,
        alert_id: rule.id,
        severity: rule.severity,
        metric: rule.metric,
        metric_value: details.metricValue,
        threshold: rule.threshold,
        trace_id: details.traceId,
        agent_type: details.agentType,
        message: details.message ?? rule.description,
        timestamp: new Date().toISOString(),
        project: process.env.LANGCHAIN_PROJECT ?? "base-agent-dev",
    };

    try {
        const response = await fetch(destination.target, {
            method: "POST",
            headers: destination.headers ?? { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            console.error(
                `❌ Alert delivery failed: ${response.status} ${response.statusText}`
            );
            return false;
        }

        console.log(`🚨 Alert fired: ${rule.name} (severity: ${rule.severity})`);
        return true;
    } catch (error) {
        console.error(
            `❌ Alert delivery error:`,
            error instanceof Error ? error.message : error
        );
        return false;
    }
}

/**
 * Setup alert rules in LangSmith.
 *
 * Logs alert configurations. LangSmith alert rule creation
 * is done through the web UI — this provides a reference.
 */
export async function setupAlerts(): Promise<{
    configured: string[];
    destination: string | null;
}> {
    const config = getAlertConfig();

    console.log(`\n🚨 Alert Configuration:`);
    for (const rule of config.rules) {
        console.log(
            `   ${rule.enabled ? "✅" : "❌"} ${rule.name}: ${rule.metric} ${rule.operator} ${rule.threshold} (${rule.windowSeconds}s window)`
        );
    }

    const destTarget = config.destination?.target ?? null;
    if (destTarget) {
        console.log(`   📬 Destination: ${config.destination!.type} → ${destTarget}`);
    } else {
        console.log(`   ⚠️ No alert destination configured — set LANGSMITH_ALERT_WEBHOOK_URL`);
    }

    return {
        configured: config.rules.filter((r) => r.enabled).map((r) => r.id),
        destination: destTarget,
    };
}
