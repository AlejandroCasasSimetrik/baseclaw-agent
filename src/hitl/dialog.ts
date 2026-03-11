/**
 * Level 9 — HITL Dialog
 *
 * Routes HITL requests to the Conversation Agent for user presentation,
 * and packages user responses back to the Reviewer Agent.
 */

import { traceable } from "langsmith/traceable";
import type { HITLRequest, HITLResponse } from "./types.js";
import { getHITLManager } from "./pause-resume.js";

/**
 * Format a HITL request for user presentation.
 *
 * Returns a human-readable message that the Conversation Agent
 * can present to the user via text and/or voice.
 */
export function formatHITLForUser(request: HITLRequest): {
    message: string;
    hasOptions: boolean;
    options: string[];
} {
    let message = `⚠️ **System Paused — Human Input Required**\n\n`;
    message += `**Reason:** ${request.reason}\n\n`;

    // Include context summary
    const contextKeys = Object.keys(request.context);
    if (contextKeys.length > 0) {
        message += `**Context:**\n`;
        for (const key of contextKeys) {
            const value = request.context[key];
            const valueStr =
                typeof value === "string"
                    ? value
                    : JSON.stringify(value, null, 2);
            message += `- **${key}:** ${valueStr.slice(0, 500)}\n`;
        }
        message += `\n`;
    }

    // Include options if structured
    if (request.options && request.options.length > 0) {
        message += `**Options:**\n`;
        request.options.forEach((opt, i) => {
            message += `  ${i + 1}. **${opt.label}**`;
            if (opt.description) {
                message += ` — ${opt.description}`;
            }
            message += `\n`;
        });
        message += `\nPlease choose an option or provide your own response.\n`;
    } else {
        message += `Please provide your input to continue.\n`;
    }

    return {
        message,
        hasOptions: !!request.options && request.options.length > 0,
        options: request.options?.map((o) => o.label) ?? [],
    };
}

/**
 * Process the user's response to a HITL request.
 *
 * Packages the response, resolves the HITL state, and returns
 * the structured response for routing to the Reviewer Agent.
 *
 * Traced as a LangSmith span.
 */
export const processHITLResponse = traceable(
    async (
        userInput: string,
        selectedOption?: string,
        routeToAgent?: string
    ): Promise<{
        response: HITLResponse;
        pauseDurationMs: number;
    }> => {
        const manager = getHITLManager();
        const currentRequest = manager.getCurrentRequest();

        if (!currentRequest) {
            throw new Error(
                "No HITL request is pending. Cannot process response."
            );
        }

        // Build the response
        const response: HITLResponse = {
            requestId: currentRequest.id,
            userInput,
            selectedOption,
            respondedAt: new Date().toISOString(),
            routeToAgent: routeToAgent ?? "reviewer",
        };

        // Resume the system
        const { pauseDurationMs } = manager.resume(response);

        console.log(
            `✅ HITL resolved after ${(pauseDurationMs / 1000).toFixed(1)}s pause`
        );

        return { response, pauseDurationMs };
    },
    { name: "hitl.dialog.processResponse", run_type: "chain" }
);
