/**
 * Centralized Model Factory
 *
 * All LLM model instances are created here. Models are configured
 * via environment variables, making it trivial to swap providers
 * (OpenAI ↔ Anthropic ↔ any LangChain-compatible provider)
 * without touching agent code.
 *
 * Environment variables:
 *   MODEL_PROVIDER          — default provider: "anthropic" | "openai" (default: "anthropic")
 *   MODEL_CONVERSATION      — model for conversation agent
 *   MODEL_IDEATION          — model for ideation agent
 *   MODEL_PLANNING          — model for planning agent
 *   MODEL_EXECUTION         — model for execution agent
 *   MODEL_REVIEWER          — model for reviewer agent
 *   MODEL_SCORER            — model for quality scorer
 *   MODEL_FEEDBACK          — model for feedback generator
 *   MODEL_MEMORY            — model for memory manager
 *
 * Each agent can also override the provider:
 *   MODEL_PROVIDER_CONVERSATION=openai  (overrides default for just conversation)
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// ── Types ────────────────────────────────────────────────

type ModelRole =
    | "conversation"
    | "ideation"
    | "planning"
    | "execution"
    | "reviewer"
    | "scorer"
    | "feedback"
    | "memory";

type Provider = "anthropic" | "openai";

interface ModelConfig {
    provider: Provider;
    model: string;
    temperature: number;
}

// ── Default Model Configuration ──────────────────────────

const MODEL_DEFAULTS: Record<ModelRole, ModelConfig> = {
    conversation: { provider: "anthropic", model: "claude-haiku-4-5-20251001", temperature: 0 },
    ideation: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", temperature: 0.7 },
    planning: { provider: "anthropic", model: "claude-opus-4-20250514", temperature: 0.2 },
    execution: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", temperature: 0.1 },
    reviewer: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", temperature: 0.1 },
    scorer: { provider: "anthropic", model: "claude-haiku-4-5-20251001", temperature: 0.1 },
    feedback: { provider: "anthropic", model: "claude-haiku-4-5-20251001", temperature: 0.2 },
    memory: { provider: "anthropic", model: "claude-haiku-4-5-20251001", temperature: 0 },
};

// ── Singleton Cache ──────────────────────────────────────

const _modelCache = new Map<string, BaseChatModel>();

// ── Config Resolution ────────────────────────────────────

function resolveConfig(role: ModelRole): ModelConfig {
    const defaults = MODEL_DEFAULTS[role];
    const envKey = role.toUpperCase();

    const provider = (
        process.env[`MODEL_PROVIDER_${envKey}`] ||
        process.env.MODEL_PROVIDER ||
        defaults.provider
    ) as Provider;

    const model =
        process.env[`MODEL_${envKey}`] ||
        defaults.model;

    const tempEnv = process.env[`MODEL_TEMPERATURE_${envKey}`];
    const temperature = tempEnv !== undefined ? parseFloat(tempEnv) : defaults.temperature;

    return { provider, model, temperature };
}

// ── Model Creation ───────────────────────────────────────

function createModel(config: ModelConfig): BaseChatModel {
    switch (config.provider) {
        case "anthropic":
            return new ChatAnthropic({
                model: config.model,
                temperature: config.temperature,
            });

        case "openai":
            return new ChatOpenAI({
                model: config.model,
                temperature: config.temperature,
            });

        default:
            throw new Error(
                `Unknown model provider: "${config.provider}". ` +
                `Supported: "anthropic", "openai". ` +
                `Set MODEL_PROVIDER in .env.`
            );
    }
}

// ── Public API ───────────────────────────────────────────

/**
 * Get the model for a specific agent role.
 * Models are cached (singleton per role) and configured via .env.
 *
 * Usage:
 *   import { getModel } from "../models/factory.js";
 *   const model = getModel("conversation");
 *   const response = await model.invoke([...messages]);
 */
export function getModel(role: ModelRole): BaseChatModel {
    // Check cache
    const cached = _modelCache.get(role);
    if (cached) return cached;

    // Resolve config from env + defaults
    const config = resolveConfig(role);
    const model = createModel(config);

    // Cache it
    _modelCache.set(role, model);

    // Log on first use
    console.log(
        `🤖 [Model] ${role}: ${config.provider}/${config.model} (temp=${config.temperature})`
    );

    return model;
}

/**
 * Get the resolved config for a role (for debugging/display).
 */
export function getModelConfig(role: ModelRole): ModelConfig {
    return resolveConfig(role);
}

/**
 * Get all model configs (for the /health endpoint or debugging).
 */
export function getAllModelConfigs(): Record<ModelRole, ModelConfig> {
    const roles: ModelRole[] = [
        "conversation", "ideation", "planning", "execution",
        "reviewer", "scorer", "feedback", "memory",
    ];
    const result: Record<string, ModelConfig> = {};
    for (const role of roles) {
        result[role] = resolveConfig(role);
    }
    return result as Record<ModelRole, ModelConfig>;
}

/**
 * Clear the model cache (useful for testing or hot-reloading config).
 */
export function clearModelCache(): void {
    _modelCache.clear();
}

/**
 * Merge a system prompt with context messages into a single string.
 *
 * Anthropic requires all system content in ONE message at the start.
 * This helper extracts text from SystemMessage[] and combines with
 * the agent's system prompt.
 *
 * Usage:
 *   const merged = mergeSystemPrompt(systemPrompt, contextMessages);
 *   await model.invoke([new SystemMessage(merged), ...state.messages]);
 */
export function mergeSystemPrompt(
    systemPrompt: string,
    contextMessages: import("@langchain/core/messages").SystemMessage[]
): string {
    if (contextMessages.length === 0) return systemPrompt;

    const contextParts = contextMessages.map((msg) =>
        typeof msg.content === "string" ? msg.content : String(msg.content)
    ).filter(Boolean);

    if (contextParts.length === 0) return systemPrompt;

    return systemPrompt + "\n\n" + contextParts.join("\n\n");
}
