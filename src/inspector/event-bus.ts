/**
 * Inspector Event Bus — Central event emitter for dev console.
 *
 * Emits typed events for skill and MCP lifecycle operations.
 * The SSE endpoints in server.ts subscribe to this bus and
 * forward events to connected browser clients.
 *
 * Singleton pattern — import `inspectorBus` from anywhere.
 */

import { EventEmitter } from "node:events";

// ── Event Types ────────────────────────────────────────────

export type SkillEventType =
    | "skill:registered"
    | "skill:unregistered"
    | "skill:loaded"
    | "skill:unloaded"
    | "skill:relevance_scored";

export type MCPEventType =
    | "mcp:registered"
    | "mcp:unregistered"
    | "mcp:connected"
    | "mcp:disconnected"
    | "mcp:tool_discovered"
    | "mcp:tool_called";

export type ContextEventType =
    | "memory:loaded"
    | "rag:loaded"
    | "context:loaded"
    | "context:unloaded";

export type MemoryEventType =
    | "memory:working_loaded"
    | "memory:working_cleared"
    | "memory:episode_written"
    | "memory:semantic_query"
    | "memory:semantic_write"
    | "memory:hitl_event"
    | "memory:feedback_loop";

export type InspectorEventType = SkillEventType | MCPEventType | ContextEventType | MemoryEventType;

// ── Event Payloads ─────────────────────────────────────────

export interface InspectorEvent {
    type: InspectorEventType;
    timestamp: string;
    data: Record<string, unknown>;
}

export interface SkillRegisteredEvent extends InspectorEvent {
    type: "skill:registered";
    data: {
        skillId: string;
        skillName: string;
        agentTypes: string[];
        category?: string;
    };
}

export interface SkillUnregisteredEvent extends InspectorEvent {
    type: "skill:unregistered";
    data: {
        skillId: string;
    };
}

export interface SkillLoadedEvent extends InspectorEvent {
    type: "skill:loaded";
    data: {
        skillId: string;
        skillName: string;
        agentType: string;
        relevanceScore: number;
    };
}

export interface SkillUnloadedEvent extends InspectorEvent {
    type: "skill:unloaded";
    data: {
        skillId: string;
        skillName?: string;
        agentType: string;
    };
}

export interface SkillRelevanceScoredEvent extends InspectorEvent {
    type: "skill:relevance_scored";
    data: {
        skillId: string;
        skillName: string;
        agentType: string;
        score: number;
        loaded: boolean;
        reason: string;
    };
}

export interface MCPRegisteredEvent extends InspectorEvent {
    type: "mcp:registered";
    data: {
        serverId: string;
        serverName: string;
        transport: string;
        agentTypes: string[] | "all";
    };
}

export interface MCPUnregisteredEvent extends InspectorEvent {
    type: "mcp:unregistered";
    data: {
        serverId: string;
    };
}

export interface MCPConnectedEvent extends InspectorEvent {
    type: "mcp:connected";
    data: {
        serverId: string;
        serverName: string;
        toolCount: number;
    };
}

export interface MCPDisconnectedEvent extends InspectorEvent {
    type: "mcp:disconnected";
    data: {
        serverId: string;
        reason?: string;
    };
}

export interface MCPToolDiscoveredEvent extends InspectorEvent {
    type: "mcp:tool_discovered";
    data: {
        serverId: string;
        toolName: string;
        description: string;
        destructive: boolean;
    };
}

export interface MCPToolCalledEvent extends InspectorEvent {
    type: "mcp:tool_called";
    data: {
        serverId: string;
        serverName: string;
        toolName: string;
        inputSummary: string;
        outputSummary: string;
        latencyMs: number;
        success: boolean;
        error?: string;
        langsmithTraceUrl?: string;
    };
}

export interface MemoryLoadedEvent extends InspectorEvent {
    type: "memory:loaded";
    data: {
        agentType: string;
        episodicCount: number;
        semanticCount: number;
    };
}

export interface RAGLoadedEvent extends InspectorEvent {
    type: "rag:loaded";
    data: {
        agentType: string;
        chunkCount: number;
        sources: string[];
    };
}

export interface ContextLoadedEvent extends InspectorEvent {
    type: "context:loaded";
    data: {
        agentType: string;
        skillIds: string[];
        mcpServerIds: string[];
        ragChunks: number;
        memoryResults: number;
    };
}

// ── Memory Event Payloads (Level 2 Inspector) ─────────────

export interface WorkingMemoryLoadedEvent extends InspectorEvent {
    type: "memory:working_loaded";
    data: {
        agentType: string;
        taskId: string;
        itemCount: number;
        tokenEstimate: number;
        tokenBudget: number;
    };
}

export interface WorkingMemoryClearedEvent extends InspectorEvent {
    type: "memory:working_cleared";
    data: {
        agentType: string;
        taskId: string;
    };
}

export interface EpisodeWrittenEvent extends InspectorEvent {
    type: "memory:episode_written";
    data: {
        agentType: string;
        episodeId: string;
        taskSummary: string;
        outcome: string;
        langsmithTraceId: string;
    };
}

export interface SemanticQueryEvent extends InspectorEvent {
    type: "memory:semantic_query";
    data: {
        agentType: string;
        namespace: string;
        querySummary: string;
        topK: number;
        resultCount: number;
        topScore: number;
        latencyMs: number;
    };
}

export interface SemanticWriteEvent extends InspectorEvent {
    type: "memory:semantic_write";
    data: {
        agentType: string;
        namespace: string;
        knowledgeType: string;
    };
}

export interface MemoryHitlEvent extends InspectorEvent {
    type: "memory:hitl_event";
    data: {
        reason: string;
        status: string;
        agentType: string;
    };
}

export interface MemoryFeedbackLoopEvent extends InspectorEvent {
    type: "memory:feedback_loop";
    data: {
        sourceAgent: string;
        targetAgent: string;
        scoreDelta: number;
    };
}

// ── Event Bus Class ────────────────────────────────────────

export class InspectorEventBus extends EventEmitter {
    /**
     * Emit a typed inspector event.
     * All events go through the "inspector" channel.
     */
    emitEvent(event: InspectorEvent): void {
        this.emit("inspector", event);
    }

    /** Convenience: emit a skill event */
    emitSkillEvent(
        type: SkillEventType,
        data: Record<string, unknown>
    ): void {
        this.emitEvent({
            type,
            timestamp: new Date().toISOString(),
            data,
        });
    }

    /** Convenience: emit an MCP event */
    emitMCPEvent(
        type: MCPEventType,
        data: Record<string, unknown>
    ): void {
        this.emitEvent({
            type,
            timestamp: new Date().toISOString(),
            data,
        });
    }

    /** Convenience: emit a context event (memory/RAG/context) */
    emitContextEvent(
        type: ContextEventType,
        data: Record<string, unknown>
    ): void {
        this.emitEvent({
            type,
            timestamp: new Date().toISOString(),
            data,
        });
    }

    /** Convenience: emit a memory event (Level 2 Inspector) */
    emitMemoryEvent(
        type: MemoryEventType,
        data: Record<string, unknown>
    ): void {
        this.emitEvent({
            type,
            timestamp: new Date().toISOString(),
            data,
        });
    }

    /** Get listener count for monitoring */
    getListenerCount(): number {
        return this.listenerCount("inspector");
    }
}

// ── Singleton ──────────────────────────────────────────────

export const inspectorBus = new InspectorEventBus();
