/**
 * Level 4 — Trace Metadata Enrichment
 *
 * Adds structured metadata to every trace and provides
 * sub-span helpers for skill scoring, memory ops, and
 * inter-agent message routing.
 */

import { traceable } from "langsmith/traceable";
import { sanitizeTraceData } from "./sanitizer.js";
import type { AgentType } from "../skills/types.js";
import type { SkillLoadResult } from "../skills/types.js";
import type { MemoryQueryResult } from "../memory/types.js";

// ── Trace Metadata ──────────────────────────────────────────

export interface TraceMetadata {
    agent_type: string;
    task_id: string;
    phase: string;
    skills_loaded: string[];
    tenant_id: string;
}

/**
 * Build a structured metadata object for trace enrichment.
 */
export function createTraceMetadata(opts: {
    agentType: AgentType;
    taskId: string;
    phase: string;
    skillsLoaded?: string[];
    tenantId?: string;
}): TraceMetadata {
    return {
        agent_type: opts.agentType,
        task_id: opts.taskId,
        phase: opts.phase,
        skills_loaded: opts.skillsLoaded ?? [],
        tenant_id: opts.tenantId ?? "default",
    };
}

// ── Sub-Span Helpers ────────────────────────────────────────

/**
 * Trace skill relevance scoring decisions.
 * Creates a child span showing which skills were considered,
 * loaded, and skipped with reasons.
 */
export const traceSkillScoring = traceable(
    async (input: {
        agentType: AgentType;
        taskContext: string;
        loadResults: SkillLoadResult[];
    }) => {
        const sanitizedInput = sanitizeTraceData(input);
        const loaded = sanitizedInput.loadResults.filter((r) => r.loaded);
        const skipped = sanitizedInput.loadResults.filter((r) => !r.loaded);

        return {
            agentType: sanitizedInput.agentType,
            taskContext: sanitizedInput.taskContext,
            totalConsidered: sanitizedInput.loadResults.length,
            loaded: loaded.map((r) => ({
                id: r.skillId,
                name: r.skillName,
                score: r.relevanceScore,
                reason: r.reason,
            })),
            skipped: skipped.map((r) => ({
                id: r.skillId,
                name: r.skillName,
                score: r.relevanceScore,
                reason: r.reason,
            })),
        };
    },
    { name: "skill.scoring", run_type: "chain" }
);

/**
 * Trace a memory read operation.
 * Covers both Episodic and Semantic memory queries.
 */
export const traceMemoryRead = traceable(
    async (input: {
        memoryType: "episodic" | "semantic";
        query: string;
        namespace?: string;
        topK?: number;
        results: Array<{ id: string; score?: number; content?: string }>;
    }) => {
        const sanitized = sanitizeTraceData(input);
        return {
            memoryType: sanitized.memoryType,
            query: sanitized.query,
            namespace: sanitized.namespace,
            topK: sanitized.topK,
            resultCount: sanitized.results.length,
            results: sanitized.results.map((r) => ({
                id: r.id,
                score: r.score,
                contentPreview: r.content?.slice(0, 200),
            })),
        };
    },
    { name: "memory.read", run_type: "retriever" }
);

/**
 * Trace a memory write operation.
 * Covers episode creation and semantic upserts.
 */
export const traceMemoryWrite = traceable(
    async (input: {
        memoryType: "episodic" | "semantic";
        operation: "insert_episode" | "upsert_knowledge";
        data: Record<string, unknown>;
        traceId?: string;
    }) => {
        const sanitized = sanitizeTraceData(input);
        return {
            memoryType: sanitized.memoryType,
            operation: sanitized.operation,
            data: sanitized.data,
            linkedTraceId: sanitized.traceId,
        };
    },
    { name: "memory.write", run_type: "chain" }
);

/**
 * Trace inter-agent message routing.
 * Shows which agent sent the message, the target, and content summary.
 */
export const traceInterAgentMessage = traceable(
    async (input: {
        fromAgent: string;
        toAgent: string;
        messageType: "route" | "response" | "feedback";
        contentSummary: string;
        reasoning?: string;
    }) => {
        const sanitized = sanitizeTraceData(input);
        return {
            from: sanitized.fromAgent,
            to: sanitized.toAgent,
            type: sanitized.messageType,
            summary: sanitized.contentSummary,
            reasoning: sanitized.reasoning,
        };
    },
    { name: "agent.routing", run_type: "chain" }
);

// ── Voice I/O Sub-Spans (Level 7) ──────────────────────────

/**
 * Trace an STT (Speech-to-Text) transcription operation.
 * No audio bytes are included — metadata only.
 */
export const traceSTT = traceable(
    async (input: {
        audioFormat: string;
        audioDurationMs: number | null;
        audioSizeBytes: number;
        provider: string;
        transcriptionText: string;
        confidenceScore: number | null;
        latencyMs: number;
        success: boolean;
        errorMessage?: string;
    }) => {
        const sanitized = sanitizeTraceData(input);
        return {
            audioFormat: sanitized.audioFormat,
            audioDurationMs: sanitized.audioDurationMs,
            audioSizeBytes: sanitized.audioSizeBytes,
            provider: sanitized.provider,
            transcriptionText: sanitized.transcriptionText,
            confidenceScore: sanitized.confidenceScore,
            latencyMs: sanitized.latencyMs,
            success: sanitized.success,
            errorMessage: sanitized.errorMessage,
        };
    },
    { name: "voice.stt", run_type: "chain" }
);

/**
 * Trace a TTS (Text-to-Speech) synthesis operation.
 * Input text is truncated for long responses. No audio bytes in trace.
 */
export const traceTTS = traceable(
    async (input: {
        inputTextPreview: string;
        voiceId: string;
        modelId: string;
        audioDurationMs: number | null;
        latencyMs: number;
        streamingUsed: boolean;
        success: boolean;
        errorMessage?: string;
    }) => {
        const sanitized = sanitizeTraceData(input);
        return {
            inputTextPreview:
                sanitized.inputTextPreview?.slice(0, 500) ?? "",
            voiceId: sanitized.voiceId,
            modelId: sanitized.modelId,
            audioDurationMs: sanitized.audioDurationMs,
            latencyMs: sanitized.latencyMs,
            streamingUsed: sanitized.streamingUsed,
            success: sanitized.success,
            errorMessage: sanitized.errorMessage,
        };
    },
    { name: "voice.tts", run_type: "chain" }
);

// ── Heartbeat Sub-Spans (Level 9) ──────────────────────────

/**
 * Trace a heartbeat fire event.
 * Shows system state evaluation, decision, and action taken.
 */
export const traceHeartbeat = traceable(
    async (input: {
        state: string;
        action: string;
        taskId?: string;
        taskTitle?: string;
        routedToAgent?: string;
        reason: string;
        fireCount: number;
        intervalMs: number;
    }) => {
        const sanitized = sanitizeTraceData(input);
        return {
            systemState: sanitized.state,
            action: sanitized.action,
            taskId: sanitized.taskId,
            taskTitle: sanitized.taskTitle,
            routedToAgent: sanitized.routedToAgent,
            reason: sanitized.reason,
            fireCount: sanitized.fireCount,
            intervalMs: sanitized.intervalMs,
        };
    },
    { name: "heartbeat.evaluation", run_type: "chain" }
);

/**
 * Trace a HITL trigger event.
 * Shows why HITL was triggered and the context presented to the user.
 */
export const traceHITLTrigger = traceable(
    async (input: {
        reason: string;
        triggeredBy: string;
        contextSummary: string;
        hasOptions: boolean;
        optionCount: number;
        requestId: string;
    }) => {
        const sanitized = sanitizeTraceData(input);
        return {
            reason: sanitized.reason,
            triggeredBy: sanitized.triggeredBy,
            contextSummary: sanitized.contextSummary?.slice(0, 500),
            hasOptions: sanitized.hasOptions,
            optionCount: sanitized.optionCount,
            requestId: sanitized.requestId,
        };
    },
    { name: "hitl.trigger", run_type: "chain" }
);

/**
 * Trace a HITL resume event.
 * Shows user response and how it was routed.
 */
export const traceHITLResume = traceable(
    async (input: {
        requestId: string;
        userInput: string;
        selectedOption?: string;
        routedToAgent: string;
        pauseDurationMs: number;
    }) => {
        const sanitized = sanitizeTraceData(input);
        return {
            requestId: sanitized.requestId,
            userInput: sanitized.userInput?.slice(0, 500),
            selectedOption: sanitized.selectedOption,
            routedToAgent: sanitized.routedToAgent,
            pauseDurationMs: sanitized.pauseDurationMs,
        };
    },
    { name: "hitl.resume", run_type: "chain" }
);
