/**
 * Level 4 — Prompt Management
 *
 * Manages agent system prompts via LangSmith's Prompt Hub.
 * Loads prompts from LangSmith at startup with local fallbacks.
 * Enables versioned prompts and future A/B testing.
 */

import { getLangSmithClient } from "./trace-config.js";

// ── Local Prompt Defaults ───────────────────────────────────

/**
 * All agent system prompts extracted from agent files.
 * These serve as fallbacks when LangSmith is unavailable.
 */
export const LOCAL_PROMPTS: Record<string, string> = {
    "baseclaw-conversation-system": `You are the Conversation Agent of Base Claw, a multi-agent system.

Your role:
- You are the ONLY user-facing agent. All user input comes through you, all responses go through you.
- Classify the user's intent and route to the appropriate specialist agent.
- For general conversation (greetings, system questions, small talk), respond directly.
- Never reveal internal routing details to the user.

You route to these specialist agents:
- **Ideation Agent**: Brainstorming, idea exploration, concept refinement, creative thinking
- **Planning Agent**: Creating plans, strategies, task decomposition, timelines, roadmaps
- **Execution Agent**: Implementing tasks, building things, coding, executing plans
- **Reviewer Agent**: Quality review, feedback, validation, checking completed work

Be warm, professional, and concise.`,

    "baseclaw-conversation-response": `You are the Conversation Agent of Base Claw, a multi-agent system.

You are now formatting the final response to the user. The specialist agent has completed their work.
Present their output naturally as if you are a unified assistant — never mention internal agents or routing.
Be warm, professional, and concise.`,

    "baseclaw-ideation-system": `You are the Ideation Agent of Base Claw, a multi-agent system.

Your role:
- Help users brainstorm, explore ideas, and refine concepts
- Ask probing questions to uncover assumptions and constraints
- Generate multiple approaches and alternatives
- Map concepts and relationships
- Define scope and success criteria

When your work is complete or you believe the idea is ready for planning, indicate that in your response.

Current task context: {{taskContext}}

Be creative, thorough, and help the user think beyond their initial framing.`,

    "baseclaw-planning-system": `You are the Planning Agent of Base Claw, a multi-agent system.

Your role:
- Create structured, actionable project plans
- Break down complex tasks into manageable steps
- Identify dependencies and potential blockers
- Estimate timelines and resource needs
- Consider risks and mitigation strategies

When your plan is complete and ready for execution, indicate that in your response.

Current task context: {{taskContext}}

Be systematic, thorough, and produce plans that can be directly executed.`,

    "baseclaw-execution-system": `You are the Execution Agent of Base Claw, a multi-agent system.

Your role:
- Execute tasks from plans or direct instructions
- Use available tools and resources efficiently
- Report progress and results clearly
- Handle errors gracefully and attempt recovery
- Know when to escalate or request human input

When your execution is complete, provide a clear summary of results.

Current task context: {{taskContext}}

Be precise, efficient, and produce quality output.`,

    "baseclaw-reviewer-system": `You are the Reviewer Agent of Base Claw, a multi-agent system.

Your role:
- Review completed work for quality, correctness, and completeness
- Provide specific, actionable feedback
- Check for edge cases, errors, and potential improvements
- Validate that deliverables meet the original requirements
- Decide whether to approve, request changes, or escalate

When your review is complete, provide a clear verdict with justification.

Current task context: {{taskContext}}

Be thorough, fair, and constructive. Quality is non-negotiable.`,
};

// ── Prompt Registry ─────────────────────────────────────────

/**
 * PromptRegistry — loads and manages prompts from LangSmith.
 *
 * Loads prompts from LangSmith Prompt Hub at startup.
 * Falls back to local defaults if LangSmith is unavailable.
 * Caches loaded prompts for the duration of the process.
 */
export class PromptRegistry {
    private cache: Map<string, string> = new Map();
    private initialized = false;

    /**
     * Load a single prompt by name.
     * Tries LangSmith first, falls back to local default.
     */
    async loadPrompt(name: string): Promise<string> {
        // Check cache first
        const cached = this.cache.get(name);
        if (cached !== undefined) {
            return cached;
        }

        // Try LangSmith
        const client = getLangSmithClient();
        if (client) {
            try {
                // Use any-cast since pullPrompt may not be in all SDK versions
                const clientAny = client as any;
                if (typeof clientAny.pullPrompt === "function") {
                    const prompt = await clientAny.pullPrompt(name);
                    if (prompt) {
                        const templateStr = this.extractTemplate(prompt);
                        if (templateStr) {
                            this.cache.set(name, templateStr);
                            return templateStr;
                        }
                    }
                }
            } catch {
                // LangSmith unavailable — fall through to local
            }
        }

        // Fallback to local
        const local = LOCAL_PROMPTS[name];
        if (local) {
            this.cache.set(name, local);
            return local;
        }

        throw new Error(`Prompt not found: ${name} (not in LangSmith or local defaults)`);
    }

    /**
     * Push a prompt to LangSmith with versioning.
     */
    async pushPrompt(name: string, template: string): Promise<boolean> {
        const client = getLangSmithClient();
        if (!client) {
            console.warn(`⚠️ Cannot push prompt "${name}" — LangSmith client not available`);
            return false;
        }

        try {
            await client.pushPrompt(name, {
                object: {
                    lc: 1,
                    type: "constructor",
                    id: ["langchain_core", "prompts", "chat", "ChatPromptTemplate"],
                    kwargs: {
                        messages: [
                            {
                                lc: 1,
                                type: "constructor",
                                id: ["langchain_core", "prompts", "chat", "SystemMessagePromptTemplate"],
                                kwargs: {
                                    prompt: {
                                        lc: 1,
                                        type: "constructor",
                                        id: ["langchain_core", "prompts", "prompt", "PromptTemplate"],
                                        kwargs: {
                                            template: template,
                                            input_variables: [],
                                            template_format: "f-string",
                                        },
                                    },
                                },
                            },
                        ],
                        input_variables: [],
                    },
                },
            });
            console.log(`✅ Prompt pushed to LangSmith: ${name}`);
            return true;
        } catch (error) {
            console.warn(
                `⚠️ Failed to push prompt "${name}":`,
                error instanceof Error ? error.message : error
            );
            return false;
        }
    }

    /**
     * Push all local prompts to LangSmith.
     */
    async pushAllPrompts(): Promise<{ pushed: string[]; failed: string[] }> {
        const pushed: string[] = [];
        const failed: string[] = [];

        for (const [name, template] of Object.entries(LOCAL_PROMPTS)) {
            const success = await this.pushPrompt(name, template);
            if (success) {
                pushed.push(name);
            } else {
                failed.push(name);
            }
        }

        return { pushed, failed };
    }

    /**
     * Get all available prompt names (local + cached).
     */
    getAvailablePrompts(): string[] {
        const names = new Set([
            ...Object.keys(LOCAL_PROMPTS),
            ...this.cache.keys(),
        ]);
        return [...names];
    }

    /**
     * Clear the prompt cache (used in tests).
     */
    clearCache(): void {
        this.cache.clear();
        this.initialized = false;
    }

    /**
     * Initialize by loading all local prompts into cache.
     * Optionally tries to refresh from LangSmith.
     */
    async initialize(refreshFromLangSmith = false): Promise<void> {
        if (this.initialized) return;

        // Pre-populate cache with local defaults
        for (const [name, template] of Object.entries(LOCAL_PROMPTS)) {
            this.cache.set(name, template);
        }

        // Optionally refresh from LangSmith
        if (refreshFromLangSmith) {
            for (const name of Object.keys(LOCAL_PROMPTS)) {
                try {
                    await this.loadPrompt(name);
                } catch {
                    // Keep local fallback
                }
            }
        }

        this.initialized = true;
    }

    /**
     * Extract template string from a LangSmith prompt object.
     */
    private extractTemplate(promptObj: any): string | null {
        try {
            // Handle ChatPromptTemplate structure
            if (typeof promptObj === "string") return promptObj;

            if (promptObj?.kwargs?.messages?.[0]?.kwargs?.prompt?.kwargs?.template) {
                return promptObj.kwargs.messages[0].kwargs.prompt.kwargs.template;
            }

            // Handle direct template
            if (promptObj?.template) return promptObj.template;

            // Handle array of messages
            if (Array.isArray(promptObj?.messages)) {
                return promptObj.messages
                    .map((m: any) => m.content ?? m.template ?? "")
                    .join("\n\n");
            }

            return null;
        } catch {
            return null;
        }
    }
}

/**
 * Singleton prompt registry instance.
 */
let _registry: PromptRegistry | null = null;

export function getPromptRegistry(): PromptRegistry {
    if (!_registry) {
        _registry = new PromptRegistry();
    }
    return _registry;
}

export function resetPromptRegistry(): void {
    _registry = null;
}
