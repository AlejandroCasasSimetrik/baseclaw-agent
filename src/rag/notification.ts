/**
 * Level 5 — Agent Notification
 *
 * Notifies the currently active agent when RAG ingestion
 * completes for a new file. Includes filename, chunk count,
 * and a suggested query to retrieve the new content.
 *
 * Traced as a LangSmith span.
 */

import { traceable } from "langsmith/traceable";
import type { RAGNotification } from "./types.js";

/**
 * Notify the active agent that new RAG content is available.
 *
 * The agent can choose to query the new content immediately
 * or continue its current task.
 *
 * Traced as a LangSmith span.
 */
export const notifyAgent = traceable(
    async (
        agentName: string,
        filename: string,
        chunkCount: number
    ): Promise<RAGNotification> => {
        const suggestedQuery = `What is the content of ${filename}?`;

        const notification: RAGNotification = {
            agentName,
            filename,
            chunkCount,
            suggestedQuery,
            timestamp: new Date().toISOString(),
        };

        return notification;
    },
    { name: "rag.notification", run_type: "chain" }
);
