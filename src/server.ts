/**
 * Level 8+9 — HTTP API Server
 *
 * Exposes Base Claw over HTTP for external clients:
 *   POST /chat    — text conversation
 *   POST /voice   — audio in → STT → chat → TTS → audio out
 *   POST /upload  — file → RAG pipeline (async)
 *   GET  /health  — system status
 *   POST /tasks   — add task to continuous task list
 *   GET  /tasks   — get task list
 *   PUT  /tasks/:id — update task
 *   DELETE /tasks/:id — remove task
 *   GET  /hitl/status — HITL status
 *   POST /hitl/respond — respond to HITL request
 *
 * Replaces the CLI readline loop from index.ts.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { HumanMessage } from "@langchain/core/messages";
import { initializeTracing } from "./tracing.js";
import { buildGraph } from "./graph.js";
import {
    SkillRegistry,
    registerBuiltinSkills,
    registerCustomSkill,
    exampleSentimentSkill,
} from "./skills/index.js";
import {
    MCPServerRegistry,
    loadMCPConfig,
    registerServersFromConfig,
} from "./mcp/index.js";
import { setSkillRegistry } from "./agents/agent-middleware.js";
import { setMCPRegistry } from "./agents/mcp-middleware.js";
import { getDefaultVoiceConfig } from "./voice/config.js";
import { processVoiceInput, generateVoiceResponse } from "./agents/conversation.js";
import { triggerRAGPipeline } from "./rag/pipeline.js";
import type { AudioInput } from "./voice/types.js";
import {
    incrementActiveInvocations,
    decrementActiveInvocations,
} from "./heartbeat/state-detector.js";
import {
    getHeartbeatScheduler,
    ContinuousTaskManager,
} from "./heartbeat/index.js";
import {
    getHITLManager,
    formatHITLForUser,
    processHITLResponse,
} from "./hitl/index.js";
import {
    inspectorBus,
    sanitizeMCPConfig,
    recordTimelineEvent,
    getTimelineEvents,
} from "./inspector/index.js";
import type { MemoryLayer } from "./inspector/index.js";
import {
    MemoryManager,
    getEpisodeById,
    getEpisodesByAgent,
    searchEpisodes,
    getRecentEpisodes as getRecentEpisodesQuery,
} from "./memory/index.js";
import type { WorkingMemoryState } from "./memory/types.js";

// ── Initialize ─────────────────────────────────────────────
initializeTracing();

// Skill Registry
const registry = new SkillRegistry();
registerBuiltinSkills(registry);
registerCustomSkill(registry, exampleSentimentSkill);
setSkillRegistry(registry);
console.log(
    `📦 Skill Registry loaded: ${registry.getAllSkills().length} skills registered`
);

// MCP Server Registry
const mcpRegistry = new MCPServerRegistry();
try {
    const mcpConfigs = loadMCPConfig();
    const registered = registerServersFromConfig(mcpRegistry, mcpConfigs);
    console.log(
        `🔌 MCP Registry loaded: ${registered.length} servers registered`
    );
} catch {
    console.log("🔌 MCP Registry: no config file found, starting empty");
}
setMCPRegistry(mcpRegistry);

// Voice Config
const voiceConfig = getDefaultVoiceConfig("default");
console.log(
    `🎤 Voice I/O: STT=${voiceConfig.sttProvider}, TTS=${voiceConfig.ttsEnabled ? "enabled" : "disabled"}`
);

// Graph
const graph = buildGraph();

// ── Express App ────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Note: Testing console UI is now in a separate repo (baseclaw-console)

// Multer — in-memory file storage (no disk writes)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ── Health Check ───────────────────────────────────────────
app.get("/health", (_req, res) => {
    const heartbeat = getHeartbeatScheduler();
    const hitlManager = getHITLManager();

    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        skills: registry.getAllSkills().length,
        mcpServers: mcpRegistry.getAvailableServers().length,
        voice: {
            sttProvider: voiceConfig.sttProvider,
            ttsEnabled: voiceConfig.ttsEnabled,
        },
        heartbeat: {
            running: heartbeat.isRunning(),
            fireCount: heartbeat.getFireCount(),
            tasksExecuted: heartbeat.getTasksExecuted(),
            lastFireTime: heartbeat.getLastFireTime(),
            startedAt: heartbeat.getStartedAt(),
            intervalMs: heartbeat.getConfig().intervalMs,
        },
        hitl: {
            state: hitlManager.getState(),
            pending: hitlManager.isPending(),
        },
    });
});

// ── Chat Endpoint (SSE streaming for real-time agent flow) ──
app.post("/chat", async (req, res) => {
    try {
        const { message, tenantId = "default" } = req.body;

        if (!message || typeof message !== "string") {
            res.status(400).json({ error: "Missing or invalid 'message' field" });
            return;
        }

        // Check if client wants streaming (Accept: text/event-stream)
        const wantsStream = req.headers.accept?.includes("text/event-stream");

        const startTime = Date.now();
        incrementActiveInvocations();

        if (wantsStream) {
            // ── SSE Streaming Mode ──
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            });

            // Increase socket timeout for long-running SSE (5 minutes)
            req.socket.setTimeout(300_000);
            res.socket?.setTimeout(300_000);

            // Flush helper — ensures data is sent to client immediately
            const sendSSE = (event: string, data: any) => {
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                // Force flush if available (Express may buffer)
                if (typeof (res as any).flush === "function") {
                    (res as any).flush();
                }
            };

            // Heartbeat — keep connection alive during long agent processing
            const heartbeat = setInterval(() => {
                try {
                    res.write(`:ping\n\n`);
                    if (typeof (res as any).flush === "function") {
                        (res as any).flush();
                    }
                } catch { /* connection already closed */ }
            }, 3_000);

            // Safety timeout — prevent infinite hang
            const timeout = setTimeout(() => {
                console.error("[/chat SSE] Safety timeout reached (120s)");
                sendSSE("error", { error: "Processing timeout" });
                clearInterval(heartbeat);
                decrementActiveInvocations();
                res.end();
            }, 120_000);

            try {
                let lastSpecialist = "conversation";
                let finalResponse = "[No response]";
                let finalCanvasWidget: any = null;

                console.log("[/chat SSE] Starting graph.stream()...");

                const stream = await graph.stream(
                    {
                        messages: [new HumanMessage(message)],
                        tenantId,
                    },
                    { recursionLimit: 50, streamMode: "updates" }
                );

                for await (const chunk of stream) {
                    // chunk is { nodeName: stateUpdate }
                    for (const [node, update] of Object.entries(chunk)) {
                        const stateUpdate = update as any;

                        console.log(`[/chat SSE] Node: ${node}, agent: ${stateUpdate?.currentAgent || node}`);
                        console.log(`[/chat SSE]   messages: ${stateUpdate?.messages ? (Array.isArray(stateUpdate.messages) ? stateUpdate.messages.length : 'single') : 'NONE'}`);

                        // Serialize messages for frontend inspection
                        let serializedPayload: any = {};
                        try {
                            serializedPayload = { ...stateUpdate };
                            // Convert BaseMessage objects to plain serializable objects
                            if (stateUpdate?.messages) {
                                const msgs = Array.isArray(stateUpdate.messages) ? stateUpdate.messages : [stateUpdate.messages];
                                serializedPayload.messages = msgs.map((m: any) => ({
                                    type: m._getType?.() || "unknown",
                                    content: m.content?.toString() || "",
                                    name: m.name || undefined,
                                    additional_kwargs: m.additional_kwargs || {},
                                }));
                            }
                            // Ensure reviewerGateState is plain object
                            if (stateUpdate?.reviewerGateState) {
                                serializedPayload.reviewerGateState = { ...stateUpdate.reviewerGateState };
                            }
                        } catch {
                            serializedPayload = { _serializationError: true };
                        }

                        if (Object.prototype.hasOwnProperty.call(stateUpdate || {}, "canvasWidget")) {
                            finalCanvasWidget = stateUpdate.canvasWidget ?? null;
                        }

                        // Emit node transition event with full payload
                        const modelRoleMap: Record<string, string> = {
                            conversation: "conversation",
                            ideation: "ideation",
                            planning: "planning",
                            execution: "execution",
                            reviewer: "reviewer",
                        };
                        const modelRole = modelRoleMap[node] || null;
                        let modelInfo = null;
                        if (modelRole) {
                            try {
                                const { getModelConfig } = await import("./models/factory.js");
                                const cfg = getModelConfig(modelRole as any);
                                modelInfo = { provider: cfg.provider, model: cfg.model };
                            } catch { }
                        }

                        const currentAgent = stateUpdate?.currentAgent || node;
                        const activeSkillIds = Array.isArray(stateUpdate?.activeSkills)
                            ? stateUpdate.activeSkills
                            : [];
                        const activeSkillDetails = activeSkillIds.map((skillId: string) => {
                            const skill = registry.getSkill(skillId);
                            return {
                                id: skillId,
                                name: skill?.name || skillId,
                                description: skill?.description || "",
                                category: skill?.category || "builtin",
                            };
                        });

                        let attachedMCPServerDetails: Array<Record<string, unknown>> = [];
                        try {
                            attachedMCPServerDetails = mcpRegistry
                                .getServersForAgent(currentAgent as any)
                                .map((server) => ({
                                    id: server.id,
                                    name: server.name,
                                    description: server.description,
                                    transport: server.transport,
                                }));
                        } catch {
                            attachedMCPServerDetails = [];
                        }

                        const workingMemorySnapshot = snapshotWorkingMemory(
                            workingMemoryStore.get(currentAgent) || null
                        );

                        serializedPayload.activeSkillDetails = activeSkillDetails;
                        serializedPayload.attachedMCPServerDetails = attachedMCPServerDetails;
                        if (!Array.isArray(serializedPayload.attachedMCPServers) || serializedPayload.attachedMCPServers.length === 0) {
                            serializedPayload.attachedMCPServers = attachedMCPServerDetails.map((server) => server.name || server.id);
                        }
                        if (!serializedPayload.workingMemory && workingMemorySnapshot) {
                            serializedPayload.workingMemory = workingMemorySnapshot;
                        }

                        // Count skills and memories from the payload
                        const skillsLoaded = stateUpdate?.activeSkills?.length ?? 0;
                        const memoriesLoaded = stateUpdate?.memoriesLoaded ?? 0;
                        const ragChunks = stateUpdate?.ragChunksLoaded ?? 0;
                        const phase = stateUpdate?.phase || node;

                        // Build a human-readable step description
                        const stepDescriptions: Record<string, string> = {
                            conversation: "Classifying intent & generating response",
                            ideation: "Brainstorming and exploring ideas",
                            planning: "Creating a structured plan",
                            execution: "Implementing the solution",
                            reviewer: "Scoring quality & reviewing output",
                        };

                        sendSSE("node_start", {
                            node,
                            agent: currentAgent,
                            timestamp: Date.now() - startTime,
                            model: modelInfo,
                            skills: skillsLoaded,
                            memories: memoriesLoaded,
                            ragChunks,
                            phase,
                            description: stepDescriptions[node] || `Processing in ${node}`,
                            payload: serializedPayload,
                        });

                        // Track the specialist agent
                        if (stateUpdate?.lastSpecialistAgent && stateUpdate.lastSpecialistAgent !== "conversation") {
                            lastSpecialist = stateUpdate.lastSpecialistAgent;
                        }
                        if (stateUpdate?.currentAgent && stateUpdate.currentAgent !== "conversation") {
                            lastSpecialist = stateUpdate.currentAgent;
                        }

                        // Extract response text from the latest AI message
                        if (stateUpdate?.messages) {
                            const msgs = Array.isArray(stateUpdate.messages) ? stateUpdate.messages : [stateUpdate.messages];
                            // Try multiple ways to find AI messages
                            const lastAi = [...msgs].reverse().find((m: any) =>
                                m._getType?.() === "ai" ||
                                m.type === "ai" ||
                                (m.constructor?.name === "AIMessage")
                            );
                            if (lastAi?.content) {
                                const txt = lastAi.content.toString();
                                if (txt && !txt.startsWith("[Reviewer]") && !txt.startsWith("[No response")) {
                                    finalResponse = txt;
                                    console.log(`[/chat SSE] Captured response from ${node} (${txt.length} chars)`);
                                }
                                if (Object.prototype.hasOwnProperty.call(lastAi?.additional_kwargs || {}, "canvasWidget")) {
                                    finalCanvasWidget = lastAi.additional_kwargs.canvasWidget ?? null;
                                }
                            } else {
                                // Fallback: any message with content
                                const anyMsg = [...msgs].reverse().find((m: any) => m.content);
                                if (anyMsg?.content) {
                                    const txt = anyMsg.content.toString();
                                    if (txt && !txt.startsWith("[Reviewer]") && !txt.startsWith("[No response")) {
                                        finalResponse = txt;
                                        console.log(`[/chat SSE] Captured response (fallback) from ${node} (${txt.length} chars)`);
                                    }
                                }
                            }
                        }
                    }
                }

                console.log(`[/chat SSE] Stream complete. Specialist: ${lastSpecialist}`);

                // Send final complete response
                sendSSE("done", {
                    response: finalResponse,
                    widget: finalCanvasWidget,
                    tenantId,
                    durationMs: Date.now() - startTime,
                    agent: lastSpecialist,
                });
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                console.error("[/chat SSE] Stream error:", errMsg);
                sendSSE("error", { error: errMsg });
            } finally {
                clearInterval(heartbeat);
                clearTimeout(timeout);
                decrementActiveInvocations();
                res.end();
            }
        } else {
            // ── Classic JSON Mode (backwards-compatible) ──
            try {
                const result = await graph.invoke(
                    {
                        messages: [new HumanMessage(message)],
                        tenantId,
                    },
                    { recursionLimit: 50 }
                );

                const messages = result.messages;
                const lastAiMessage = [...messages]
                    .reverse()
                    .find((m: any) => m._getType() === "ai");

                const response = lastAiMessage?.content?.toString() || "[No response]";
                const widget = lastAiMessage?.additional_kwargs?.canvasWidget ?? result.canvasWidget ?? null;

                res.json({
                    response,
                    widget,
                    tenantId,
                    durationMs: Date.now() - startTime,
                    agent: result.lastSpecialistAgent || result.currentAgent || "conversation",
                });
            } finally {
                decrementActiveInvocations();
            }
        }
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[/chat] Error:", errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// ── Voice Endpoint ─────────────────────────────────────────
app.post("/voice", upload.single("audio"), async (req, res) => {
    try {
        const tenantId = req.body?.tenantId || "default";

        if (!req.file) {
            res.status(400).json({ error: "No audio file uploaded. Use 'audio' field." });
            return;
        }

        const startTime = Date.now();
        const config = getDefaultVoiceConfig(tenantId);

        // Build AudioInput from uploaded file
        const ext = req.file.originalname?.split(".").pop()?.toLowerCase() || "wav";
        const audioInput: AudioInput = {
            buffer: req.file.buffer,
            format: ext as any,
            sizeBytes: req.file.size,
            durationMs: 0, // Unknown — STT will handle
        };

        // STT — transcribe audio to text
        const sttResult = await processVoiceInput(audioInput, config);

        if (sttResult.errorMessage) {
            res.status(422).json({
                error: sttResult.errorMessage,
                transcribedText: sttResult.transcribedText || null,
            });
            return;
        }

        // Track active invocations for heartbeat state detection
        incrementActiveInvocations();
        try {
            // Run through agent graph
            const result = await graph.invoke(
                {
                    messages: [new HumanMessage(sttResult.transcribedText)],
                    tenantId,
                    voiceInput: sttResult.voiceInputState,
                },
                { recursionLimit: 50 }
            );

            // Extract AI response text
            const messages = result.messages;
            const lastAiMessage = [...messages]
                .reverse()
                .find((m: any) => m._getType() === "ai");
            const responseText = lastAiMessage?.content?.toString() || "[No response]";

            // TTS — generate audio response
            let audioResponse: { audio: string; format: string; durationMs: number } | null = null;
            if (config.ttsEnabled) {
                const ttsResult = await generateVoiceResponse(responseText, config);
                if (ttsResult && ttsResult.audioBuffer) {
                    audioResponse = {
                        audio: ttsResult.audioBuffer.toString("base64"),
                        format: ttsResult.format,
                        durationMs: ttsResult.durationMs ?? 0,
                    };
                }
            }

            res.json({
                transcription: sttResult.transcribedText,
                response: responseText,
                audio: audioResponse,
                voiceMetadata: sttResult.voiceInputState,
                tenantId,
                durationMs: Date.now() - startTime,
            });
        } finally {
            decrementActiveInvocations();
        }
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[/voice] Error:", errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// ── File Upload Endpoint ───────────────────────────────────
app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const tenantId = req.body?.tenantId || "default";

        if (!req.file) {
            res.status(400).json({ error: "No file uploaded. Use 'file' field." });
            return;
        }

        const filename = req.file.originalname || "unknown";

        // Fire-and-forget — pipeline runs async, with completion logging
        const fileBuffer = req.file.buffer;
        triggerRAGPipeline({
            filename,
            content: fileBuffer,
            sizeBytes: req.file.size,
            tenantId,
            activePhase: "upload",
            activeAgent: "conversation",
        }, (result) => {
            if (result.success) {
                console.log(`[/upload] ✅ "${filename}" → ${result.chunkCount} chunks (${result.durationMs}ms)`);
                // Save original file to uploads/ for download
                try {
                    const uploadsDir = path.join(process.cwd(), "uploads");
                    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
                    fs.writeFileSync(path.join(uploadsDir, filename), fileBuffer);
                } catch (e) { console.warn(`[/upload] Could not save file to disk: ${(e as Error).message}`); }
            } else {
                console.warn(`[/upload] ❌ "${filename}" failed: ${result.error || result.rejectionReason || "unknown"}`);
            }
        });

        // Respond immediately with 202 Accepted
        res.status(202).json({
            accepted: true,
            filename,
            sizeBytes: req.file.size,
            tenantId,
            message: `File "${filename}" accepted for RAG processing. Ingestion is running asynchronously.`,
        });
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[/upload] Error:", errMsg);
        res.status(500).json({ error: errMsg });
    }
});

// ── Task Management Endpoints (Level 9) ────────────────────

app.post("/tasks", async (req, res) => {
    try {
        const { title, description, priority, assignedAgent, tenantId = "default" } = req.body;
        if (!title || !description) {
            res.status(400).json({ error: "Missing 'title' and/or 'description'" });
            return;
        }
        const taskManager = new ContinuousTaskManager(tenantId);
        const task = await taskManager.addTask({ title, description, priority, assignedAgent });
        res.status(201).json(task);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: errMsg });
    }
});

app.get("/tasks", async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || "default";
        const taskManager = new ContinuousTaskManager(tenantId);
        const tasks = await taskManager.getTaskList();
        res.json(tasks);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: errMsg });
    }
});

app.put("/tasks/:id", async (req, res) => {
    try {
        const { tenantId = "default", ...updates } = req.body;
        const taskManager = new ContinuousTaskManager(tenantId);
        const updated = await taskManager.updateTask(req.params.id, updates);
        if (!updated) {
            res.status(404).json({ error: "Task not found" });
            return;
        }
        res.json(updated);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: errMsg });
    }
});

app.delete("/tasks/:id", async (req, res) => {
    try {
        const tenantId = (req.query.tenantId as string) || "default";
        const taskManager = new ContinuousTaskManager(tenantId);
        const removed = await taskManager.removeTask(req.params.id);
        if (!removed) {
            res.status(404).json({ error: "Task not found" });
            return;
        }
        res.json({ removed: true });
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: errMsg });
    }
});

// ── HITL Endpoints (Level 9) ───────────────────────────────

app.get("/hitl/status", (_req, res) => {
    const hitlManager = getHITLManager();
    const currentRequest = hitlManager.getCurrentRequest();
    const formatted = currentRequest ? formatHITLForUser(currentRequest) : null;

    res.json({
        state: hitlManager.getState(),
        pending: hitlManager.isPending(),
        pauseDurationMs: hitlManager.getPauseDuration(),
        request: currentRequest
            ? {
                id: currentRequest.id,
                reason: currentRequest.reason,
                options: currentRequest.options,
                createdAt: currentRequest.createdAt,
            }
            : null,
        formatted: formatted?.message ?? null,
    });
});

app.post("/hitl/respond", async (req, res) => {
    try {
        const { userInput, selectedOption, routeToAgent } = req.body;
        if (!userInput || typeof userInput !== "string") {
            res.status(400).json({ error: "Missing or invalid 'userInput'" });
            return;
        }
        const result = await processHITLResponse(userInput, selectedOption, routeToAgent);
        res.json(result);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: errMsg });
    }
});

// ── Agent Graph Endpoint (for flow visualizer) ────────────
app.get("/agents/graph", (_req, res) => {
    res.json({
        nodes: [
            { id: "conversation", label: "Conversation", color: "#3b82f6" },
            { id: "ideation", label: "Ideation", color: "#a855f7" },
            { id: "planning", label: "Planning", color: "#10b981" },
            { id: "execution", label: "Execution", color: "#f59e0b" },
            { id: "reviewer", label: "Reviewer", color: "#ef4444" },
        ],
        edges: [
            ["conversation", "ideation"], ["conversation", "planning"],
            ["conversation", "execution"], ["conversation", "reviewer"],
            ["ideation", "reviewer"], ["planning", "reviewer"],
            ["execution", "reviewer"], ["reviewer", "conversation"],
        ],
        entryPoint: "conversation",
    });
});

// ── Inspector API (Dev Console) ────────────────────────────

// Dev console gate middleware
const isDevConsoleEnabled = process.env.ENABLE_DEV_CONSOLE === "true";

function devConsoleAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    if (!isDevConsoleEnabled) {
        res.status(403).json({ error: "Dev console is disabled" });
        return;
    }
    // Token check (optional — if DEV_CONSOLE_TOKEN is set, require it)
    const requiredToken = process.env.DEV_CONSOLE_TOKEN;
    if (requiredToken && requiredToken.length > 0) {
        const provided = req.headers["x-dev-token"] as string | undefined;
        if (provided !== requiredToken) {
            res.status(403).json({ error: "Invalid dev console token" });
            return;
        }
    }
    next();
}

// Simple in-memory rate limiter for /api/ routes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 60; // requests per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function rateLimiter(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
): void {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
        rateLimitMap.set(ip, entry);
    }

    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        res.status(429).json({ error: "Rate limit exceeded" });
        return;
    }
    next();
}

// Apply to all /api/ routes
app.use("/api", devConsoleAuth, rateLimiter);

// ── Skills API ─────────────────────────────────────────────

app.get("/api/skills/registry", (_req, res) => {
    const skills = registry.getAllSkills().map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        agentTypes: skill.agentTypes,
        category: skill.category || "builtin",
        isBuiltIn: !skill.id.startsWith("custom."),
        systemPromptPreview: skill.systemPromptFragment.slice(0, 150) + (
            skill.systemPromptFragment.length > 150 ? "…" : ""
        ),
    }));
    res.json({ skills, count: skills.length });
});

app.get("/api/skills/loaded/:agentType", (req, res) => {
    const agentType = req.params.agentType as any;
    const validTypes = ["conversation", "ideation", "planning", "execution", "reviewer"];
    if (!validTypes.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }
    const skills = registry.getSkillsForAgent(agentType).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        agentTypes: skill.agentTypes,
        category: skill.category || "builtin",
        isBuiltIn: !skill.id.startsWith("custom."),
    }));
    res.json({ agentType, skills, count: skills.length });
});

// ── MCP API ────────────────────────────────────────────────

app.get("/api/mcp/registry", (_req, res) => {
    const servers = mcpRegistry.getAvailableServers().map(sanitizeMCPConfig);
    res.json({ servers, count: servers.length });
});

app.get("/api/mcp/attached/:agentType", (req, res) => {
    const agentType = req.params.agentType as any;
    const validTypes = ["conversation", "ideation", "planning", "execution", "reviewer"];
    if (!validTypes.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }
    const servers = mcpRegistry.getServersForAgent(agentType).map(sanitizeMCPConfig);
    res.json({ agentType, servers, count: servers.length });
});

app.get("/api/mcp/tools/:serverId", (req, res) => {
    const server = mcpRegistry.getServer(req.params.serverId);
    if (!server) {
        res.status(404).json({ error: `Server '${req.params.serverId}' not found` });
        return;
    }
    // Return server info + placeholder for discovered tools
    // (tools are discovered at runtime when the MCP client connects)
    res.json({
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        description: server.description,
        destructiveTools: server.destructiveTools,
        // Discovered tools would come from the MCP client connection
        tools: [],
        message: "Tools are discovered at runtime when the server connects",
    });
});

// ── In-Memory Event Stores (for Node Inspector) ────────────

interface SkillEventEntry {
    type: string;
    skillId: string;
    skillName: string;
    agentType: string;
    relevanceScore?: number;
    loaded?: boolean;
    reason?: string;
    timestamp: string;
}

interface MCPToolCallEntry {
    serverId: string;
    serverName: string;
    toolName: string;
    latencyMs: number;
    success: boolean;
    error?: string;
    timestamp: string;
}

const skillEventLog = new Map<string, SkillEventEntry[]>();
const mcpToolCallLog = new Map<string, MCPToolCallEntry[]>();
const MAX_SKILL_EVENTS = 50;
const MAX_TOOL_CALLS = 20;

// ── Memory Inspector In-Memory Stores ──────────────────────

/** Per-agent working memory snapshots — updated via SSE events or API */
const workingMemoryStore = new Map<string, WorkingMemoryState | null>();

function snapshotWorkingMemory(wm: WorkingMemoryState | null): Record<string, unknown> | null {
    if (!wm) return null;

    return {
        taskId: wm.taskId,
        taskDescription: wm.taskDescription,
        currentGoal: wm.currentGoal,
        activePlanSteps: wm.activePlanSteps.slice(-10),
        recentToolResults: wm.recentToolResults.slice(-10),
        mcpCallResults: wm.mcpCallResults.slice(-10),
        ragResults: wm.ragResults.slice(-10),
        interAgentMessages: wm.interAgentMessages.slice(-10),
        loadedSkillDefinitions: wm.loadedSkillDefinitions.slice(-10),
        createdAt: wm.createdAt,
        tokenUsage: {
            current: wm.currentTokenEstimate,
            max: wm.maxTokenBudget,
            percentage: Math.round((wm.currentTokenEstimate / wm.maxTokenBudget) * 100),
        },
    };
}

/** Per-agent semantic query log */
interface SemanticQueryLogEntry {
    query: string;
    namespace: string;
    topK: number;
    resultCount: number;
    topScore: number;
    latencyMs: number;
    timestamp: string;
    results?: Array<{ content: string; score: number; source: string }>;
}
const semanticQueryLog = new Map<string, SemanticQueryLogEntry[]>();
const MAX_SEMANTIC_QUERIES = 30;

// Subscribe to inspector bus to record events
inspectorBus.on("inspector", (event: any) => {
    const agentType = event.data?.agentType;
    if (!agentType) return;

    // Record skill events
    if (event.type?.startsWith("skill:")) {
        if (!skillEventLog.has(agentType)) skillEventLog.set(agentType, []);
        const log = skillEventLog.get(agentType)!;
        log.push({
            type: event.type,
            skillId: event.data.skillId || "",
            skillName: event.data.skillName || event.data.skillId || "",
            agentType,
            relevanceScore: event.data.relevanceScore ?? event.data.score,
            loaded: event.data.loaded,
            reason: event.data.reason,
            timestamp: event.timestamp,
        });
        if (log.length > MAX_SKILL_EVENTS) log.splice(0, log.length - MAX_SKILL_EVENTS);
    }

    // Record MCP tool calls
    if (event.type === "mcp:tool_called") {
        if (!mcpToolCallLog.has(agentType)) mcpToolCallLog.set(agentType, []);
        const log = mcpToolCallLog.get(agentType)!;
        log.push({
            serverId: event.data.serverId || "",
            serverName: event.data.serverName || "",
            toolName: event.data.toolName || "",
            latencyMs: event.data.latencyMs || 0,
            success: event.data.success ?? true,
            error: event.data.error,
            timestamp: event.timestamp,
        });
        if (log.length > MAX_TOOL_CALLS) log.splice(0, log.length - MAX_TOOL_CALLS);
    }

    // Record memory events → timeline
    if (event.type === "memory:working_loaded") {
        workingMemoryStore.set(agentType, event.data.snapshot as WorkingMemoryState || null);
        recordTimelineEvent("working", agentType, event.type,
            `WM loaded: ${event.data.itemCount || 0} items`,
            event.data);
    }
    if (event.type === "memory:working_cleared") {
        workingMemoryStore.set(agentType, null);
        recordTimelineEvent("working", agentType, event.type,
            `WM cleared for task ${event.data.taskId || ""}`,
            event.data);
    }
    if (event.type === "memory:episode_written") {
        recordTimelineEvent("episodic", agentType, event.type,
            `Episode: ${event.data.taskSummary || ""} → ${event.data.outcome || ""}`,
            event.data);
    }
    if (event.type === "memory:semantic_query") {
        if (!semanticQueryLog.has(agentType)) semanticQueryLog.set(agentType, []);
        const slog = semanticQueryLog.get(agentType)!;
        slog.push({
            query: (event.data.querySummary as string) || "",
            namespace: (event.data.namespace as string) || "",
            topK: (event.data.topK as number) || 5,
            resultCount: (event.data.resultCount as number) || 0,
            topScore: (event.data.topScore as number) || 0,
            latencyMs: (event.data.latencyMs as number) || 0,
            timestamp: event.timestamp,
            results: event.data.results || [],
        });
        if (slog.length > MAX_SEMANTIC_QUERIES) slog.splice(0, slog.length - MAX_SEMANTIC_QUERIES);
        recordTimelineEvent("semantic", agentType, event.type,
            `Query "${event.data.querySummary || ""}" → ${event.data.resultCount || 0} results`,
            event.data);
    }
    if (event.type === "memory:semantic_write") {
        recordTimelineEvent("semantic", agentType, event.type,
            `Write to ${event.data.namespace || "knowledge"}: ${event.data.knowledgeType || ""}`,
            event.data);
    }
    if (event.type === "memory:hitl_event") {
        recordTimelineEvent("episodic", agentType, event.type,
            `HITL: ${event.data.reason || ""} (${event.data.status || ""})`,
            event.data);
    }
    if (event.type === "memory:feedback_loop") {
        const src = event.data.sourceAgent || agentType;
        const tgt = event.data.targetAgent || "";
        recordTimelineEvent("episodic", agentType, event.type,
            `Feedback: ${src} → ${tgt} (delta: ${event.data.scoreDelta || 0})`,
            event.data);
    }
});

// ── Node-Centric API (for Canvas Inspector) ────────────────

const VALID_AGENT_TYPES = ["conversation", "ideation", "planning", "execution", "reviewer"];

app.get("/api/node/:agentType/skills", (req, res) => {
    const agentType = req.params.agentType as any;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    const allSkills = registry.getSkillsForAgent(agentType).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category || "builtin",
        isBuiltIn: !skill.id.startsWith("custom."),
    }));

    // Get recent events to determine which are currently loaded
    const events = skillEventLog.get(agentType) || [];
    const loadedSet = new Set<string>();
    const relevanceMap = new Map<string, number>();
    const lastLoadedMap = new Map<string, string>();
    const loadCountMap = new Map<string, number>();
    const skipReasonMap = new Map<string, string>();

    // Walk events to build current state
    for (const ev of events) {
        if (ev.type === "skill:loaded") {
            loadedSet.add(ev.skillId);
            if (ev.relevanceScore !== undefined) relevanceMap.set(ev.skillId, ev.relevanceScore);
            lastLoadedMap.set(ev.skillId, ev.timestamp);
            loadCountMap.set(ev.skillId, (loadCountMap.get(ev.skillId) || 0) + 1);
        } else if (ev.type === "skill:unloaded") {
            loadedSet.delete(ev.skillId);
        } else if (ev.type === "skill:relevance_scored" && !ev.loaded) {
            skipReasonMap.set(ev.skillId, ev.reason || "below threshold");
        }
    }

    const loaded = allSkills
        .filter((s) => loadedSet.has(s.id))
        .map((s) => ({
            ...s,
            loaded: true,
            relevanceScore: relevanceMap.get(s.id) ?? null,
            lastLoaded: lastLoadedMap.get(s.id) ?? null,
            loadCount: loadCountMap.get(s.id) || 0,
        }));

    const available = allSkills
        .filter((s) => !loadedSet.has(s.id))
        .map((s) => ({
            ...s,
            loaded: false,
            relevanceScore: relevanceMap.get(s.id) ?? null,
            skipReason: skipReasonMap.get(s.id) ?? null,
        }));

    const recentEvents = events.slice(-20).reverse();

    res.json({ agentType, loaded, available, recentEvents, totalAvailable: allSkills.length });
});

app.get("/api/node/:agentType/mcps", (req, res) => {
    const agentType = req.params.agentType as any;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    const servers = mcpRegistry.getServersForAgent(agentType).map((server) => ({
        id: server.id,
        name: server.name,
        transport: server.transport,
        description: server.description,
        agentTypes: server.agentTypes,
        toolCount: 0, // Tools discovered at runtime
        status: "registered",
    }));

    const recentToolCalls = (mcpToolCallLog.get(agentType) || []).slice(-10).reverse();

    res.json({ agentType, servers, recentToolCalls });
});

app.get("/api/node/:agentType/rag", (req, res) => {
    const agentType = req.params.agentType as any;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    // RAG state is tracked via SSE events — return what we know
    // In a full implementation, this would query the RAG store directly
    res.json({
        agentType,
        chunks: 0,
        sources: [],
        message: "RAG state is delivered via SSE events. Use /api/inspector/events to stream live updates.",
    });
});

app.get("/api/node/:agentType/summary", (req, res) => {
    const agentType = req.params.agentType as any;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    const totalSkills = registry.getSkillsForAgent(agentType).length;
    const events = skillEventLog.get(agentType) || [];
    const loadedSet = new Set<string>();
    for (const ev of events) {
        if (ev.type === "skill:loaded") loadedSet.add(ev.skillId);
        else if (ev.type === "skill:unloaded") loadedSet.delete(ev.skillId);
    }

    const mcpCount = mcpRegistry.getServersForAgent(agentType).length;

    res.json({
        agentType,
        skills: { loaded: loadedSet.size, total: totalSkills },
        mcps: { attached: mcpCount },
        rag: { chunks: 0 },  // Updated via SSE
    });
});

// ── Memory Inspector API (Level 2) ─────────────────────────

const TENANT_ID = "default";

// GET /api/node/:agentType/memory/working — Working Memory snapshot
app.get("/api/node/:agentType/memory/working", (req, res) => {
    const agentType = req.params.agentType;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    const wm = workingMemoryStore.get(agentType) || null;
    if (!wm) {
        res.json({ agentType, status: "idle", workingMemory: null });
        return;
    }

    res.json({
        agentType,
        status: "active",
        workingMemory: {
            taskId: wm.taskId,
            taskDescription: wm.taskDescription,
            currentGoal: wm.currentGoal,
            activePlanSteps: wm.activePlanSteps,
            recentToolResults: wm.recentToolResults.slice(-10),
            mcpCallResults: wm.mcpCallResults.slice(-10),
            ragResults: wm.ragResults.slice(-10),
            interAgentMessages: wm.interAgentMessages.slice(-10),
            loadedSkillDefinitions: wm.loadedSkillDefinitions,
            createdAt: wm.createdAt,
            tokenUsage: {
                current: wm.currentTokenEstimate,
                max: wm.maxTokenBudget,
                percentage: Math.round((wm.currentTokenEstimate / wm.maxTokenBudget) * 100),
            },
        },
    });
});

// GET /api/node/:agentType/memory/episodic — Recent episodes
app.get("/api/node/:agentType/memory/episodic", async (req, res) => {
    const agentType = req.params.agentType;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    try {
        const episodes = await getEpisodesByAgent(TENANT_ID, agentType);
        const paginated = episodes.slice(offset, offset + limit);

        res.json({
            agentType,
            episodes: paginated.map(ep => ({
                id: ep.id,
                taskDescription: ep.taskDescription,
                outcome: ep.outcome,
                durationMs: ep.durationMs,
                langsmithTraceId: ep.langsmithTraceId,
                createdAt: ep.createdAt,
                metadata: ep.metadata,
            })),
            total: episodes.length,
            limit,
            offset,
        });
    } catch (err: any) {
        res.json({
            agentType,
            episodes: [],
            total: 0,
            error: "Database unavailable",
            message: err.message,
        });
    }
});

// GET /api/node/:agentType/memory/episodic/search — Search episodes
app.get("/api/node/:agentType/memory/episodic/search", async (req, res) => {
    const agentType = req.params.agentType;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    const query = (req.query.q as string) || "";
    if (!query) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
    }

    try {
        const results = await searchEpisodes(TENANT_ID, query);
        // Filter by agentType
        const filtered = results.filter(ep => ep.agentType === agentType);

        res.json({
            agentType,
            query,
            episodes: filtered.map(ep => ({
                id: ep.id,
                taskDescription: ep.taskDescription,
                outcome: ep.outcome,
                durationMs: ep.durationMs,
                langsmithTraceId: ep.langsmithTraceId,
                createdAt: ep.createdAt,
            })),
            total: filtered.length,
        });
    } catch (err: any) {
        res.json({ agentType, query, episodes: [], total: 0, error: "Database unavailable" });
    }
});

// GET /api/episode/:episodeId — Full episode detail
app.get("/api/episode/:episodeId", async (req, res) => {
    const episodeId = req.params.episodeId;

    try {
        const episode = await getEpisodeById(TENANT_ID, episodeId);
        if (!episode) {
            res.status(404).json({ error: "Episode not found" });
            return;
        }

        res.json({
            episode: {
                id: episode.id,
                agentType: episode.agentType,
                taskDescription: episode.taskDescription,
                outcome: episode.outcome,
                durationMs: episode.durationMs,
                langsmithTraceId: episode.langsmithTraceId,
                createdAt: episode.createdAt,
                metadata: episode.metadata,
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: "Database unavailable", message: err.message });
    }
});

// GET /api/node/:agentType/memory/semantic — Namespace access + recent queries
app.get("/api/node/:agentType/memory/semantic", (req, res) => {
    const agentType = req.params.agentType;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    const isReviewer = agentType === "reviewer";

    const namespaces = {
        rag: { read: true, write: false },
        knowledge: {
            read: true,
            write: isReviewer,  // Only reviewer can write to knowledge
        },
    };

    const recentQueries = (semanticQueryLog.get(agentType) || []).slice(-20).reverse();

    res.json({
        agentType,
        namespaces,
        recentQueries,
        totalQueries: recentQueries.length,
    });
});

// POST /api/node/:agentType/memory/semantic/query — Ad-hoc query
app.post("/api/node/:agentType/memory/semantic/query", async (req, res) => {
    const agentType = req.params.agentType;
    if (!VALID_AGENT_TYPES.includes(agentType)) {
        res.status(400).json({ error: `Invalid agent type: ${agentType}` });
        return;
    }

    const { query, namespace = "rag", topK = 5 } = req.body;
    if (!query) {
        res.status(400).json({ error: "'query' is required in request body" });
        return;
    }

    if (namespace !== "rag" && namespace !== "knowledge") {
        res.status(400).json({ error: "namespace must be 'rag' or 'knowledge'" });
        return;
    }

    const start = Date.now();
    try {
        const mm = new MemoryManager(TENANT_ID);
        const results = namespace === "rag"
            ? await mm.queryRAG(query, topK)
            : await mm.queryKnowledge(query, topK);
        const latencyMs = Date.now() - start;

        // Log this query
        const topScore = results.length > 0 ? Math.max(...results.map(r => r.score)) : 0;
        inspectorBus.emitMemoryEvent("memory:semantic_query", {
            agentType,
            namespace,
            querySummary: query.slice(0, 80),
            topK,
            resultCount: results.length,
            topScore,
            latencyMs,
        });

        res.json({
            agentType,
            namespace,
            query,
            topK,
            results: results.map(r => ({
                id: r.id,
                score: r.score,
                content: r.content?.slice(0, 500),
                metadata: r.metadata,
            })),
            latencyMs,
        });
    } catch (err: any) {
        res.json({
            agentType,
            namespace,
            query,
            results: [],
            error: "Semantic memory unavailable",
            message: err.message,
        });
    }
});

// DELETE /api/memory/reset/:namespace — Reset a memory store
app.delete("/api/memory/reset/:namespace", async (req, res) => {
    const ns = req.params.namespace;
    try {
        if (ns === "knowledge") {
            // Clear Pinecone knowledge namespace
            const { getIndex } = await import("./memory/semantic/pinecone.js");
            const index = getIndex();
            await index.namespace("knowledge").deleteAll();
            res.json({ success: true, namespace: ns, message: `Knowledge namespace cleared` });
        } else if (ns === "rag") {
            // Clear Pinecone RAG namespace
            const { getIndex } = await import("./memory/semantic/pinecone.js");
            const index = getIndex();
            await index.namespace("rag").deleteAll();
            // Clear file_uploads from PostgreSQL
            try {
                const { getDb } = await import("./memory/episodic/db.js");
                const { sql } = await import("drizzle-orm");
                const db = getDb();
                await db.execute(sql`DELETE FROM file_uploads`);
            } catch { /* DB might not be available */ }
            // Clear uploads/ directory
            try {
                const uploadsDir = path.join(process.cwd(), "uploads");
                if (fs.existsSync(uploadsDir)) {
                    const files = fs.readdirSync(uploadsDir);
                    for (const f of files) fs.unlinkSync(path.join(uploadsDir, f));
                }
            } catch { /* Disk cleanup is best-effort */ }
            res.json({ success: true, namespace: ns, message: `RAG namespace, file records, and uploaded files cleared` });
        } else if (ns === "episodic") {
            // Clear PostgreSQL: file_uploads first (FK dep), then episodes
            const { getDb } = await import("./memory/episodic/db.js");
            const { sql } = await import("drizzle-orm");
            const db = getDb();
            await db.execute(sql`TRUNCATE TABLE episodes CASCADE`);
            res.json({ success: true, namespace: ns, message: `Episodic memory and all related records cleared` });
        } else {
            res.status(400).json({ error: `Invalid namespace: ${ns}. Use rag, knowledge, or episodic.` });
        }
    } catch (err: any) {
        console.error(`[reset] Failed to reset ${ns}:`, err.message);
        res.status(500).json({ error: `Failed to reset ${ns}: ${err.message}` });
    }
});

// GET /api/rag/files — List all uploaded RAG files
app.get("/api/rag/files", async (_req, res) => {
    try {
        const { getDb } = await import("./memory/episodic/db.js");
        const { fileUploads } = await import("./memory/episodic/schema.js");
        const { desc, eq } = await import("drizzle-orm");
        const db = getDb();
        const files = await db
            .select()
            .from(fileUploads)
            .where(eq(fileUploads.tenantId, TENANT_ID))
            .orderBy(desc(fileUploads.createdAt));
        res.json({ files });
    } catch (err: any) {
        res.json({ files: [], error: err.message });
    }
});

// GET /api/user-preferences — Read user preferences markdown
app.get("/api/user-preferences", (_req, res) => {
    const prefsFile = path.join(process.cwd(), "data", "user-preferences.md");
    if (!fs.existsSync(prefsFile)) {
        res.json({ content: "", facts: [] });
        return;
    }
    const content = fs.readFileSync(prefsFile, "utf-8");
    // Extract fact lines
    const facts = content.split("\n").filter(l => l.startsWith("- ")).map(l => l.slice(2));
    res.json({ content, facts });
});

// DELETE /api/user-preferences — Clear user preferences
app.delete("/api/user-preferences", (_req, res) => {
    const prefsFile = path.join(process.cwd(), "data", "user-preferences.md");
    if (fs.existsSync(prefsFile)) fs.unlinkSync(prefsFile);
    res.json({ cleared: true });
});

// GET /api/rag/files/:filename/download — Download an uploaded file
app.get("/api/rag/files/:filename/download", (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(process.cwd(), "uploads", filename);
    if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "File not found on disk" });
        return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.sendFile(filePath);
});

// DELETE /api/rag/files/:filename — Delete a specific file from RAG
app.delete("/api/rag/files/:filename", async (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    try {
        // Delete from Pinecone rag namespace by source_file metadata
        const { getIndex } = await import("./memory/semantic/pinecone.js");
        const index = getIndex();
        const ragNs = index.namespace("rag") as any;
        // Pinecone deleteMany with metadata filter
        await ragNs.deleteMany({ filter: { source_file: { $eq: filename } } });

        // Delete from PostgreSQL file_uploads
        const { getDb } = await import("./memory/episodic/db.js");
        const { fileUploads } = await import("./memory/episodic/schema.js");
        const { eq, and } = await import("drizzle-orm");
        const db = getDb();
        await db.delete(fileUploads).where(
            and(
                eq(fileUploads.tenantId, TENANT_ID),
                eq(fileUploads.filename, filename)
            )
        );

        res.json({ success: true, filename, message: `File "${filename}" deleted from RAG` });
    } catch (err: any) {
        res.status(500).json({ error: `Failed to delete "${filename}": ${err.message}` });
    }
});

// GET /api/memory/timeline — Cross-agent memory timeline
app.get("/api/memory/timeline", (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const layers = req.query.layers
        ? (req.query.layers as string).split(",") as MemoryLayer[]
        : undefined;
    const agentType = req.query.agentType as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);

    const events = getTimelineEvents({ from, to, layers, agentType, limit });

    res.json({
        events,
        total: events.length,
        filters: { from, to, layers, agentType, limit },
    });
});

app.get("/api/skills/events", (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    // Send initial heartbeat
    res.write("event: connected\ndata: {\"status\":\"connected\"}\n\n");

    const listener = (event: any) => {
        if (event.type?.startsWith("skill:")) {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            if (typeof (res as any).flush === "function") {
                (res as any).flush();
            }
        }
    };

    inspectorBus.on("inspector", listener);

    // Keep-alive every 30s
    const keepAlive = setInterval(() => {
        res.write(": keepalive\n\n");
    }, 30_000);

    req.on("close", () => {
        inspectorBus.off("inspector", listener);
        clearInterval(keepAlive);
    });
});

app.get("/api/mcp/events", (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    // Send initial heartbeat
    res.write("event: connected\ndata: {\"status\":\"connected\"}\n\n");

    const listener = (event: any) => {
        if (event.type?.startsWith("mcp:")) {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            if (typeof (res as any).flush === "function") {
                (res as any).flush();
            }
        }
    };

    inspectorBus.on("inspector", listener);

    // Keep-alive every 30s
    const keepAlive = setInterval(() => {
        res.write(": keepalive\n\n");
    }, 30_000);

    req.on("close", () => {
        inspectorBus.off("inspector", listener);
        clearInterval(keepAlive);
    });
});

// Unified inspector stream — all events in one SSE connection
app.get("/api/inspector/events", (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    });

    res.write("event: connected\ndata: {\"status\":\"connected\"}\n\n");

    const listener = (event: any) => {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (typeof (res as any).flush === "function") {
            (res as any).flush();
        }
    };

    inspectorBus.on("inspector", listener);

    const keepAlive = setInterval(() => {
        res.write(": keepalive\n\n");
    }, 30_000);

    req.on("close", () => {
        inspectorBus.off("inspector", listener);
        clearInterval(keepAlive);
    });
});

// ── Start Server ───────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? "3000", 10);

const httpServer = createServer(app);

// ── WebSocket Server for Live Voice Calls ──────────────────
const wss = new WebSocketServer({ server: httpServer, path: "/ws/voice-call" });

wss.on("connection", (ws) => {
    console.log("[WS] Live call connected");
    let audioChunks: Buffer[] = [];
    let isProcessing = false;

    ws.send(JSON.stringify({ type: "status", text: "Connected — speak now" }));
    ws.send(JSON.stringify({ type: "listening" }));

    ws.on("message", async (data: Buffer) => {
        if (isProcessing) return;

        audioChunks.push(Buffer.from(data));

        // Process after receiving enough audio (at least 2 chunks)
        if (audioChunks.length >= 1) {
            isProcessing = true;
            const audioBuffer = Buffer.concat(audioChunks);
            audioChunks = [];

            try {
                ws.send(JSON.stringify({ type: "status", text: "Processing…" }));

                const config = getDefaultVoiceConfig("default");

                // Build AudioInput
                const audioInput: import("./voice/types.js").AudioInput = {
                    buffer: audioBuffer,
                    format: "webm",
                    sizeBytes: audioBuffer.length,
                    durationMs: 0,
                };

                // STT
                const sttResult = await processVoiceInput(audioInput, config);

                if (sttResult.errorMessage || !sttResult.transcribedText) {
                    ws.send(JSON.stringify({ type: "status", text: "Could not transcribe — try again" }));
                    ws.send(JSON.stringify({ type: "listening" }));
                    isProcessing = false;
                    return;
                }

                ws.send(JSON.stringify({ type: "transcription", text: sttResult.transcribedText }));

                // Run through agent graph
                incrementActiveInvocations();
                try {
                    const result = await graph.invoke(
                        {
                            messages: [new HumanMessage(sttResult.transcribedText)],
                            tenantId: "default",
                            voiceInput: sttResult.voiceInputState,
                        },
                        { recursionLimit: 50 }
                    );

                    const messages = result.messages;
                    const lastAiMessage = [...messages]
                        .reverse()
                        .find((m: any) => m._getType() === "ai");
                    const responseText = lastAiMessage?.content?.toString() || "[No response]";

                    ws.send(JSON.stringify({
                        type: "response",
                        text: responseText,
                        agent: result.lastSpecialistAgent || result.currentAgent || "conversation",
                    }));

                    // TTS — send audio back
                    if (config.ttsEnabled) {
                        ws.send(JSON.stringify({ type: "speaking" }));
                        const ttsResult = await generateVoiceResponse(responseText, config);
                        if (ttsResult && ttsResult.audioBuffer && ws.readyState === WebSocket.OPEN) {
                            ws.send(ttsResult.audioBuffer);
                        }
                    }
                } finally {
                    decrementActiveInvocations();
                }

                ws.send(JSON.stringify({ type: "listening" }));
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                console.error("[WS] Error:", errMsg);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "status", text: `Error: ${errMsg}` }));
                    ws.send(JSON.stringify({ type: "listening" }));
                }
            }

            isProcessing = false;
        }
    });

    ws.on("close", () => {
        console.log("[WS] Live call disconnected");
    });

    ws.on("error", (err) => {
        console.error("[WS] WebSocket error:", err.message);
    });
});
// ── Auto-start only when run directly (not imported by tests) ──
const isDirectRun = process.argv[1]?.includes("server");

if (isDirectRun) {
    const server = httpServer.listen(PORT, () => {
        console.log("\n🦀 Base Claw — Multi-Agent System");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`🌐 Server running on http://localhost:${PORT}`);
        console.log(`🖥️  Testing Console: http://localhost:${PORT}`);
        console.log(`   POST /chat          — text conversation`);
        console.log(`   POST /voice         — voice I/O (audio in → audio out)`);
        console.log(`   POST /upload        — file upload → RAG pipeline`);
        console.log(`   GET  /health        — system status`);
        console.log(`   POST /tasks         — add task to continuous task list`);
        console.log(`   GET  /tasks         — get task list`);
        console.log(`   PUT  /tasks/:id     — update task`);
        console.log(`   DELETE /tasks/:id   — remove task`);
        console.log(`   GET  /hitl/status   — HITL status`);
        console.log(`   POST /hitl/respond  — respond to HITL request`);
        console.log(`   WS   /ws/voice-call — live voice call`);
        console.log(`   GET  /agents/graph  — agent graph topology\n`);

        // ── Start Heartbeat (Level 9) ──────────────────────────
        const heartbeat = getHeartbeatScheduler();
        heartbeat.setGraphInvoke(async (input, config) => graph.invoke(input, config));
        heartbeat.start();
    });

    // ── Graceful Shutdown ──────────────────────────────────────
    async function shutdown() {
        console.log("\n👋 Base Claw shutting down...");
        const heartbeat = getHeartbeatScheduler();
        await heartbeat.stop();
        server.close();
        process.exit(0);
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

export { app, httpServer };
