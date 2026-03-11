/**
 * Level 4 — Evaluator Templates
 *
 * Defines evaluator functions for assessing agent performance.
 * Used with LangSmith's evaluation framework.
 *
 * Evaluator types:
 *   - LLM-as-judge: uses an LLM to score quality
 *   - Heuristic: uses programmatic rules to score
 */

import { getModel } from "../models/factory.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

// ── Types ───────────────────────────────────────────────────

export interface EvaluatorResult {
    key: string;
    score: number;
    comment?: string;
}

export interface EvaluatorInput {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    referenceOutputs?: Record<string, unknown>;
}

// ── LLM-as-Judge Evaluators (uses centralized model factory) ───

/** Get the evaluator model from the centralized factory */
function getEvalModel() {
    return getModel("scorer");
}

/**
 * Routing Accuracy Evaluator (LLM-as-judge)
 *
 * Checks: Did the Conversation Agent route to the correct agent?
 * Inputs: user message, selected route
 * Reference: expected route
 */
export async function routingAccuracyEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const userMessage = String(input.inputs.message ?? input.inputs.userMessage ?? "");
    const selectedRoute = String(input.outputs.route ?? input.outputs.selectedAgent ?? "");
    const expectedRoute = input.referenceOutputs
        ? String(input.referenceOutputs.route ?? input.referenceOutputs.expectedAgent ?? "")
        : "";

    try {
        const model = getEvalModel();
        const response = await model.invoke([
            new SystemMessage(
                `You are an evaluator for an AI routing system. The system has 5 agents: conversation (general chat), ideation (brainstorming), planning (creating plans), execution (implementing tasks), reviewer (quality review).

Given a user message, the selected route, and the expected route, score how accurate the routing decision was.

Return ONLY a JSON object: {"score": <0.0 to 1.0>, "reasoning": "<brief explanation>"}
Score 1.0 = perfect match, 0.5 = reasonable but not ideal, 0.0 = completely wrong.`
            ),
            new HumanMessage(
                `User message: "${userMessage}"
Selected route: "${selectedRoute}"
Expected route: "${expectedRoute}"`
            ),
        ]);

        const content = typeof response.content === "string" ? response.content : "";
        const parsed = JSON.parse(content);
        return {
            key: "routing_accuracy",
            score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
            comment: parsed.reasoning ?? "",
        };
    } catch {
        // Fallback: exact match
        const score = selectedRoute === expectedRoute ? 1.0 : 0.0;
        return {
            key: "routing_accuracy",
            score,
            comment: `Exact match fallback: ${score === 1.0 ? "matched" : "mismatch"}`,
        };
    }
}

/**
 * Skill Relevance Evaluator (heuristic)
 *
 * Checks: Were the right skills loaded for the task?
 * Uses keyword matching between task context and loaded skills.
 */
export async function skillRelevanceEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const taskContext = String(input.inputs.taskContext ?? "").toLowerCase();
    const loadedSkills = (input.outputs.skillsLoaded ?? []) as string[];
    const expectedSkills = (input.referenceOutputs?.expectedSkills ?? []) as string[];

    if (expectedSkills.length === 0) {
        // No reference — check if loaded skills' names relate to task keywords
        const taskWords = taskContext.split(/\s+/).filter((w) => w.length > 3);
        let matchCount = 0;
        for (const skill of loadedSkills) {
            const skillLower = skill.toLowerCase();
            if (taskWords.some((w) => skillLower.includes(w) || w.includes(skillLower))) {
                matchCount++;
            }
        }
        const score = loadedSkills.length === 0 ? 0.5 : matchCount / loadedSkills.length;
        return {
            key: "skill_relevance",
            score: Math.max(0, Math.min(1, score)),
            comment: `${matchCount}/${loadedSkills.length} skills matched task keywords`,
        };
    }

    // With reference: check overlap
    const loadedSet = new Set(loadedSkills.map((s) => s.toLowerCase()));
    const expectedSet = new Set(expectedSkills.map((s) => s.toLowerCase()));
    const intersection = [...expectedSet].filter((s) => loadedSet.has(s));
    const union = new Set([...loadedSet, ...expectedSet]);
    const score = union.size === 0 ? 1.0 : intersection.length / union.size;

    return {
        key: "skill_relevance",
        score: Math.max(0, Math.min(1, score)),
        comment: `Jaccard similarity: ${intersection.length} overlap / ${union.size} union`,
    };
}

/**
 * Memory Retrieval Quality Evaluator (LLM-as-judge)
 *
 * Checks: Did the memory query return relevant context?
 */
export async function memoryRetrievalQualityEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const query = String(input.inputs.query ?? "");
    const retrievedContext = String(input.outputs.context ?? input.outputs.retrievedContext ?? "");

    try {
        const model = getEvalModel();
        const response = await model.invoke([
            new SystemMessage(
                `You are an evaluator for a memory retrieval system. Given a query and the retrieved context, score how relevant and useful the retrieved information is.

Return ONLY a JSON object: {"score": <0.0 to 1.0>, "reasoning": "<brief explanation>"}
Score 1.0 = highly relevant, 0.5 = somewhat relevant, 0.0 = irrelevant or empty.`
            ),
            new HumanMessage(
                `Query: "${query}"
Retrieved context: "${retrievedContext}"`
            ),
        ]);

        const content = typeof response.content === "string" ? response.content : "";
        const parsed = JSON.parse(content);
        return {
            key: "memory_retrieval_quality",
            score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
            comment: parsed.reasoning ?? "",
        };
    } catch {
        const score = retrievedContext.length > 0 ? 0.5 : 0.0;
        return {
            key: "memory_retrieval_quality",
            score,
            comment: `Fallback: context ${retrievedContext.length > 0 ? "present" : "empty"}`,
        };
    }
}

/**
 * Response Quality Evaluator (LLM-as-judge)
 *
 * Checks: Is the agent's response helpful and accurate?
 */
export async function responseQualityEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const userMessage = String(input.inputs.message ?? input.inputs.userMessage ?? "");
    const agentResponse = String(input.outputs.response ?? input.outputs.answer ?? "");

    try {
        const model = getEvalModel();
        const response = await model.invoke([
            new SystemMessage(
                `You are an evaluator for an AI assistant. Given a user message and the agent's response, score the quality of the response.

Consider: helpfulness, accuracy, completeness, conciseness, and professionalism.

Return ONLY a JSON object: {"score": <0.0 to 1.0>, "reasoning": "<brief explanation>"}
Score 1.0 = excellent, 0.5 = adequate, 0.0 = unhelpful or wrong.`
            ),
            new HumanMessage(
                `User message: "${userMessage}"
Agent response: "${agentResponse}"`
            ),
        ]);

        const content = typeof response.content === "string" ? response.content : "";
        const parsed = JSON.parse(content);
        return {
            key: "response_quality",
            score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
            comment: parsed.reasoning ?? "",
        };
    } catch {
        const score = agentResponse.length > 10 ? 0.5 : 0.0;
        return {
            key: "response_quality",
            score,
            comment: `Fallback: response length ${agentResponse.length} chars`,
        };
    }
}

/**
 * RAG Retrieval Quality Evaluator (LLM-as-judge) — Level 5
 *
 * Checks: Given a query and retrieved RAG chunks, are the chunks
 * relevant and useful for answering the query?
 */
export async function ragRetrievalQualityEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const query = String(input.inputs.query ?? input.inputs.question ?? "");
    const retrievedChunks = input.outputs.chunks ?? input.outputs.retrievedChunks ?? [];
    const chunksText = Array.isArray(retrievedChunks)
        ? retrievedChunks.map((c: any) => String(c.text ?? c.content ?? c)).join("\n---\n")
        : String(retrievedChunks);

    try {
        const model = getEvalModel();
        const response = await model.invoke([
            new SystemMessage(
                `You are an evaluator for a Retrieval-Augmented Generation (RAG) system. Given a user query and the retrieved document chunks, score how relevant and useful the retrieved chunks are for answering the query.

Consider:
- Relevance: Do the chunks contain information related to the query?
- Coverage: Do the chunks cover the main aspects of what the query is asking?
- Quality: Is the retrieved information accurate and well-structured?
- Noise: Are there irrelevant chunks that dilute the useful ones?

Return ONLY a JSON object: {"score": <0.0 to 1.0>, "reasoning": "<brief explanation>"}
Score 1.0 = highly relevant and complete, 0.5 = partially relevant, 0.0 = irrelevant or empty.`
            ),
            new HumanMessage(
                `Query: "${query}"

Retrieved chunks:
${chunksText || "(no chunks retrieved)"}`
            ),
        ]);

        const content = typeof response.content === "string" ? response.content : "";
        const parsed = JSON.parse(content);
        return {
            key: "rag_retrieval_quality",
            score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
            comment: parsed.reasoning ?? "",
        };
    } catch {
        const score = chunksText.length > 0 ? 0.5 : 0.0;
        return {
            key: "rag_retrieval_quality",
            score,
            comment: `Fallback: chunks ${chunksText.length > 0 ? "present" : "empty"}`,
        };
    }
}

/**
 * MCP Tool Accuracy Evaluator (LLM-as-judge) — Level 6
 *
 * Checks: Given a task and the MCP tool calls made, were the right
 * tools selected and used with correct inputs?
 */
export async function mcpToolAccuracyEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const task = String(input.inputs.task ?? input.inputs.taskDescription ?? "");
    const toolCalls = input.outputs.mcpToolCalls ?? input.outputs.toolCalls ?? [];
    const toolCallsText = Array.isArray(toolCalls)
        ? toolCalls
            .map(
                (c: any) =>
                    `Server: ${c.serverName ?? c.serverId}, Tool: ${c.toolName}, Input: ${JSON.stringify(c.input ?? {})}, Success: ${c.success ?? "unknown"}`
            )
            .join("\n")
        : String(toolCalls);

    const availableTools = input.inputs.availableTools ?? [];
    const availableToolsText = Array.isArray(availableTools)
        ? availableTools.map((t: any) => `${t.name}: ${t.description}`).join("\n")
        : String(availableTools);

    try {
        const model = getEvalModel();
        const response = await model.invoke([
            new SystemMessage(
                `You are an evaluator for an AI agent's MCP (Model Context Protocol) tool usage. Given a task, the available MCP tools, and the actual tool calls made, score how accurately the agent selected and used the tools.

Consider:
- Tool Selection: Did the agent pick the right tools for the task?
- Input Accuracy: Were the tool inputs correct and well-formed?
- Completeness: Did the agent make all necessary tool calls?
- Efficiency: Were unnecessary tool calls avoided?
- Error Handling: If calls failed, was the agent's response appropriate?

Return ONLY a JSON object: {"score": <0.0 to 1.0>, "reasoning": "<brief explanation>"}
Score 1.0 = perfect tool usage, 0.5 = partially correct, 0.0 = completely wrong or no tools used when needed.`
            ),
            new HumanMessage(
                `Task: "${task}"

Available MCP Tools:
${availableToolsText || "(none listed)"}

Actual Tool Calls Made:
${toolCallsText || "(no tool calls made)"}`
            ),
        ]);

        const content = typeof response.content === "string" ? response.content : "";
        const parsed = JSON.parse(content);
        return {
            key: "mcp_tool_accuracy",
            score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
            comment: parsed.reasoning ?? "",
        };
    } catch {
        const score = toolCallsText.length > 0 ? 0.5 : 0.0;
        return {
            key: "mcp_tool_accuracy",
            score,
            comment: `Fallback: tool calls ${toolCallsText.length > 0 ? "present" : "empty"}`,
        };
    }
}

/**
 * Sub-agent Efficiency Evaluator (LLM-as-judge) — Level 8
 *
 * Checks: Given a parent task and its sub-agent usage, were sub-agents
 * used appropriately? Scores based on:
 *   - Were the right number of sub-agents spawned?
 *   - Were tasks distributed correctly among sub-agents?
 *   - Was sub-agent spawning necessary or could the parent have handled it?
 */
export async function subAgentEfficiencyEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const parentTask = String(input.inputs.parentTask ?? input.inputs.task ?? "");
    const subAgentCount = Number(input.outputs.subAgentCount ?? 0);
    const subAgentTasks = (input.outputs.subAgentTasks ?? []) as string[];
    const subAgentResults = (input.outputs.subAgentResults ?? []) as string[];
    const totalDurationMs = Number(input.outputs.totalDurationMs ?? 0);

    const subAgentSummary = subAgentTasks
        .map(
            (task: string, i: number) =>
                `Sub-agent ${i + 1}: Task="${task}" | Result="${subAgentResults[i] ?? "(no result)"}"`
        )
        .join("\n");

    try {
        const model = getEvalModel();
        const response = await model.invoke([
            new SystemMessage(
                `You are an evaluator for an AI agent's sub-agent spawning strategy. Given a parent task, the number of sub-agents spawned, their tasks, and their results, score how efficiently sub-agents were used.

Consider:
- Necessity: Was spawning sub-agents appropriate for this task, or could the parent have handled it alone?
- Count: Were too many or too few sub-agents spawned?
- Task Distribution: Were tasks divided logically among sub-agents? Is there overlap or gaps?
- Result Quality: Did each sub-agent contribute meaningfully to the overall result?
- Efficiency: Was parallel execution used effectively?

Return ONLY a JSON object: {"score": <0.0 to 1.0>, "reasoning": "<brief explanation>"}
Score 1.0 = optimal sub-agent usage, 0.5 = reasonable but could be improved, 0.0 = wasteful or completely wrong usage. If no sub-agents were spawned, score based on whether spawning would have been beneficial.`
            ),
            new HumanMessage(
                `Parent Task: "${parentTask}"

Number of sub-agents spawned: ${subAgentCount}
Total execution time: ${totalDurationMs}ms

Sub-agent Details:
${subAgentSummary || "(no sub-agents spawned)"}`
            ),
        ]);

        const content = typeof response.content === "string" ? response.content : "";
        const parsed = JSON.parse(content);
        return {
            key: "sub_agent_efficiency",
            score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
            comment: parsed.reasoning ?? "",
        };
    } catch {
        // Fallback heuristic
        const score = subAgentCount > 0 && subAgentCount <= 5 ? 0.5 : 0.3;
        return {
            key: "sub_agent_efficiency",
            score,
            comment: `Fallback: ${subAgentCount} sub-agents spawned`,
        };
    }
}

/**
 * All evaluator templates, indexable by key.
 */
export const EVALUATOR_TEMPLATES = {
    routing_accuracy: routingAccuracyEvaluator,
    skill_relevance: skillRelevanceEvaluator,
    memory_retrieval_quality: memoryRetrievalQualityEvaluator,
    response_quality: responseQualityEvaluator,
    rag_retrieval_quality: ragRetrievalQualityEvaluator,
    mcp_tool_accuracy: mcpToolAccuracyEvaluator,
    sub_agent_efficiency: subAgentEfficiencyEvaluator,
    // Level 10 — Reviewer Loop Evaluators
    review_consistency: reviewConsistencyEvaluator,
    feedback_actionability: feedbackActionabilityEvaluator,
    revision_improvement: revisionImprovementEvaluator,
    distillation_quality: distillationQualityEvaluator,
    mandatory_gate_coverage: mandatoryGateCoverageEvaluator,
    drift_detection_accuracy: driftDetectionAccuracyEvaluator,
    checkpoint_responsiveness: checkpointResponsivenessEvaluator,
} as const;

export type EvaluatorKey = keyof typeof EVALUATOR_TEMPLATES;

// ── Level 10 — Reviewer Loop Evaluators ─────────────────────

/**
 * Review Consistency Evaluator (heuristic)
 *
 * Checks: Given the same output twice, did the Reviewer produce
 * consistent scores? (within 5 points)
 */
export async function reviewConsistencyEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const score1 = Number(input.outputs.score1 ?? 0);
    const score2 = Number(input.outputs.score2 ?? 0);
    const diff = Math.abs(score1 - score2);
    const score = diff <= 5 ? 1.0 : diff <= 10 ? 0.7 : diff <= 20 ? 0.4 : 0.1;

    return {
        key: "review_consistency",
        score,
        comment: `Score difference: ${diff} points (threshold: 5). Score 1: ${score1}, Score 2: ${score2}`,
    };
}

/**
 * Feedback Actionability Evaluator (LLM-as-judge)
 *
 * Checks: Is the Reviewer's feedback specific enough to act on?
 */
export async function feedbackActionabilityEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const feedback = String(input.outputs.feedback ?? "");

    try {
        const model = getEvalModel();
        const response = await model.invoke([
            new SystemMessage(
                `You are an evaluator for feedback quality. Given reviewer feedback, score how actionable and specific it is. Good feedback has clear issues, specific suggestions, and isn't vague.

Return ONLY a JSON object: {"score": <0.0 to 1.0>, "reasoning": "<brief explanation>"}
Score 1.0 = extremely actionable, 0.5 = somewhat useful, 0.0 = vague or unhelpful.`
            ),
            new HumanMessage(`Reviewer Feedback:\n${feedback}`),
        ]);

        const content = typeof response.content === "string" ? response.content : "";
        const parsed = JSON.parse(content);
        return {
            key: "feedback_actionability",
            score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
            comment: parsed.reasoning ?? "",
        };
    } catch {
        const score = feedback.length > 100 ? 0.5 : 0.2;
        return {
            key: "feedback_actionability",
            score,
            comment: `Fallback: feedback length ${feedback.length} chars`,
        };
    }
}

/**
 * Revision Improvement Evaluator (heuristic)
 *
 * Checks: Did the agent's revision improve the score?
 */
export async function revisionImprovementEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const preScore = Number(input.outputs.preRevisionScore ?? 0);
    const postScore = Number(input.outputs.postRevisionScore ?? 0);
    const improvement = postScore - preScore;

    let score: number;
    if (improvement >= 15) score = 1.0;
    else if (improvement >= 10) score = 0.8;
    else if (improvement >= 5) score = 0.6;
    else if (improvement > 0) score = 0.4;
    else score = 0.1;

    return {
        key: "revision_improvement",
        score,
        comment: `Score change: ${preScore} → ${postScore} (${improvement >= 0 ? "+" : ""}${improvement} points)`,
    };
}

/**
 * Distillation Quality Evaluator (LLM-as-judge)
 *
 * Checks: Are distilled knowledge entries useful for future tasks?
 */
export async function distillationQualityEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const knowledge = String(input.outputs.distilledKnowledge ?? "");
    const knowledgeType = String(input.outputs.knowledgeType ?? "unknown");

    try {
        const model = getEvalModel();
        const response = await model.invoke([
            new SystemMessage(
                `You are an evaluator for knowledge distillation quality. Given a distilled knowledge entry, score how useful and reusable it would be for future tasks.

Consider: Is it specific enough to be actionable? Is it general enough to apply beyond one task? Would an agent benefit from knowing this?

Return ONLY a JSON object: {"score": <0.0 to 1.0>, "reasoning": "<brief explanation>"}
Score 1.0 = highly reusable insight, 0.5 = somewhat useful, 0.0 = trivial or not reusable.`
            ),
            new HumanMessage(
                `Knowledge Type: ${knowledgeType}\nDistilled Knowledge: "${knowledge}"`
            ),
        ]);

        const content = typeof response.content === "string" ? response.content : "";
        const parsed = JSON.parse(content);
        return {
            key: "distillation_quality",
            score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
            comment: parsed.reasoning ?? "",
        };
    } catch {
        const score = knowledge.length > 50 ? 0.5 : 0.2;
        return {
            key: "distillation_quality",
            score,
            comment: `Fallback: knowledge length ${knowledge.length} chars`,
        };
    }
}

/**
 * Mandatory Gate Coverage Evaluator (heuristic)
 *
 * Checks: Do 100% of agent completions have a corresponding Reviewer Gate trace?
 * ANY gap is a critical architecture failure.
 */
export async function mandatoryGateCoverageEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const totalCompletions = Number(input.outputs.totalAgentCompletions ?? 0);
    const gateTraces = Number(input.outputs.reviewerGateTraces ?? 0);

    if (totalCompletions === 0) {
        return {
            key: "mandatory_gate_coverage",
            score: 1.0,
            comment: "No agent completions to verify.",
        };
    }

    const coverage = gateTraces / totalCompletions;
    const score = coverage >= 1.0 ? 1.0 : 0.0; // Binary: 100% or failure

    return {
        key: "mandatory_gate_coverage",
        score,
        comment: `Coverage: ${gateTraces}/${totalCompletions} = ${(coverage * 100).toFixed(1)}%. ` +
            (score === 1.0 ? "All completions gated." : "CRITICAL: Missing gate traces!"),
    };
}

/**
 * Drift Detection Accuracy Evaluator (heuristic)
 *
 * Checks: Given scenarios with intentional drift, did the Reviewer catch it?
 */
export async function driftDetectionAccuracyEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const driftScenarios = Number(input.outputs.totalDriftScenarios ?? 0);
    const driftsCaught = Number(input.outputs.driftsCaught ?? 0);

    if (driftScenarios === 0) {
        return {
            key: "drift_detection_accuracy",
            score: 1.0,
            comment: "No drift scenarios to evaluate.",
        };
    }

    const accuracy = driftsCaught / driftScenarios;

    return {
        key: "drift_detection_accuracy",
        score: Math.max(0, Math.min(1, accuracy)),
        comment: `Drift detection: ${driftsCaught}/${driftScenarios} caught (${(accuracy * 100).toFixed(1)}%)`,
    };
}

/**
 * Checkpoint Responsiveness Evaluator (heuristic)
 *
 * Checks: For long tasks, are mid-execution checkpoints happening
 * at the configured interval?
 */
export async function checkpointResponsivenessEvaluator(
    input: EvaluatorInput
): Promise<EvaluatorResult> {
    const totalSteps = Number(input.outputs.totalSteps ?? 0);
    const checkpointCount = Number(input.outputs.checkpointCount ?? 0);
    const configuredInterval = Number(input.outputs.configuredInterval ?? 3);

    if (totalSteps < configuredInterval) {
        return {
            key: "checkpoint_responsiveness",
            score: 1.0,
            comment: `Task too short for checkpoints (${totalSteps} steps, interval: ${configuredInterval}).`,
        };
    }

    const expectedCheckpoints = Math.floor(totalSteps / configuredInterval);
    const ratio =
        expectedCheckpoints > 0
            ? checkpointCount / expectedCheckpoints
            : 1.0;
    const score = Math.min(1.0, ratio);

    return {
        key: "checkpoint_responsiveness",
        score,
        comment: `Checkpoints: ${checkpointCount}/${expectedCheckpoints} expected (interval: ${configuredInterval}, steps: ${totalSteps})`,
    };
}

