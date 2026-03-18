import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { WorkingMemoryState } from "./memory/types.js";
import type { VoiceInputState } from "./voice/types.js";
import type { ReviewerGateState } from "./reviewer-loop/types.js";
import { defaultReviewerGateState } from "./reviewer-loop/types.js";

export interface CanvasWidgetOption {
    label: string;
    description?: string;
}

export interface CanvasWidgetQuestion {
    question: string;
    options: CanvasWidgetOption[];
}

export interface CanvasWidgetState {
    type: "ideation-question" | "planning-tracker" | "reviewer-auth" | "reviewer-walkthrough";
    title?: string;
    description?: string;
    questions?: CanvasWidgetQuestion[];
    [key: string]: unknown;
}

/**
 * BaseClawState — Central state schema for the multi-agent system.
 *
 * Every agent reads from and writes to this shared state.
 * Messages use an append reducer (conversation history grows).
 * All other fields use overwrite semantics.
 */
export const BaseClawState = Annotation.Root({
    /**
     * Full conversation history. Append-only via reducer.
     * All agents share this message stream.
     */
    messages: Annotation<BaseMessage[]>({
        reducer: (existing, incoming) => existing.concat(incoming),
        default: () => [],
    }),

    /**
     * Which agent is currently active.
     * Updated by routing logic when control transfers between agents.
     */
    currentAgent: Annotation<string>({
        reducer: (_prev, next) => next,
        default: () => "conversation",
    }),

    /**
     * The last specialist agent that handled a request.
     * Set by specialist agents (ideation, planning, execution, reviewer).
     * NOT overwritten by conversation agent wrap-up — persists for API responses.
     */
    lastSpecialistAgent: Annotation<string>({
        reducer: (_prev, next) => next,
        default: () => "conversation",
    }),

    /**
     * Current phase of the workflow.
     * One of: conversation, ideation, planning, execution, review
     */
    phase: Annotation<string>({
        reducer: (_prev, next) => next,
        default: () => "conversation",
    }),

    /**
     * Safety counter — increments each time an agent node executes.
     * Prevents infinite loops in the mesh.
     */
    iterationCount: Annotation<number>({
        reducer: (_prev, next) => next,
        default: () => 0,
    }),

    /**
     * Maximum allowed iterations before the graph forces a halt.
     * Configurable per invocation. Default: 25.
     */
    maxIterations: Annotation<number>({
        reducer: (_prev, next) => next,
        default: () => 25,
    }),

    /**
     * Current task description — set by the Conversation Agent
     * when routing to a specialist agent.
     */
    taskContext: Annotation<string>({
        reducer: (_prev, next) => next,
        default: () => "",
    }),

    /**
     * IDs of currently active/loaded skills for the current agent's task.
     * Populated by the skill loader, cleared after task completion.
     * Added in Level 2 — Skill System.
     */
    activeSkills: Annotation<string[]>({
        reducer: (_prev, next) => next,
        default: () => [],
    }),

    /**
     * Per-task ephemeral scratchpad. Holds current task context,
     * plan steps, tool results, RAG results, inter-agent messages.
     * Created when a task starts, discarded when it completes.
     * Added in Level 3 — Memory Layer.
     */
    workingMemory: Annotation<WorkingMemoryState | null>({
        reducer: (_prev, next) => next,
        default: () => null,
    }),

    /**
     * IDs of MCP servers currently attached to the active agent.
     * Managed by the MCPAttachmentManager.
     * Added in Level 6 — MCP Integration.
     */
    attachedMCPServers: Annotation<string[]>({
        reducer: (_prev, next) => next,
        default: () => [],
    }),

    /**
     * Voice input metadata — populated when the user sends a voice message.
     * Contains the transcribed text, audio metadata, and STT provider info.
     * Null when the input is text-only.
     * Added in Level 7 — Voice I/O.
     */
    voiceInput: Annotation<VoiceInputState | null>({
        reducer: (_prev, next) => next,
        default: () => null,
    }),

    /**
     * Tenant identifier — scopes memory, config, and MCP operations.
     * Set when the graph is invoked. Defaults to "default".
     * Added in Level 8 — Integration Layer.
     */
    tenantId: Annotation<string>({
        reducer: (_prev, next) => next,
        default: () => "default",
    }),

    /**
     * HITL (Human-in-the-Loop) state.
     * When set, the system is paused waiting for human input.
     * Only the Reviewer Agent can trigger this.
     * Added in Level 9 — Heartbeat & HITL.
     */
    hitlState: Annotation<{ pending: boolean; requestId: string | null }>({
        reducer: (_prev, next) => next,
        default: () => ({ pending: false, requestId: null }),
    }),

    /**
     * Reviewer Gate state — tracks the mandatory review cycle.
     * Includes source agent, revision count, revision history,
     * and pending feedback for the current review.
     * Added in Level 10 — Reviewer Loop.
     */
    reviewerGateState: Annotation<ReviewerGateState>({
        reducer: (_prev, next) => next,
        default: () => defaultReviewerGateState(),
    }),

    /**
     * Optional canvas widget payload emitted by the backend.
     * Used by the console to render structured, interactive UI
     * without reverse-engineering prose responses.
     */
    canvasWidget: Annotation<CanvasWidgetState | null>({
        reducer: (_prev, next) => next,
        default: () => null,
    }),
});

/** TypeScript type alias for the state object */
export type BaseClawStateType = typeof BaseClawState.State;
