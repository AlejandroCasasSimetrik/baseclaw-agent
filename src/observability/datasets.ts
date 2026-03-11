/**
 * Level 4 — Dataset Management
 *
 * Creates and seeds LangSmith datasets for evaluation.
 * Each agent type gets its own dataset populated with
 * synthetic test cases from Levels 1–3 behaviors.
 */

import { getLangSmithClient } from "./trace-config.js";
import type { AgentType } from "../skills/types.js";

// ── Types ───────────────────────────────────────────────────

export interface DatasetExample {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
}

export interface DatasetConfig {
    name: string;
    description: string;
    agentType: AgentType | "system";
    examples: DatasetExample[];
}

// ── Synthetic Test Data ─────────────────────────────────────

export const CONVERSATION_EXAMPLES: DatasetExample[] = [
    {
        inputs: { message: "Hello, how are you?" },
        outputs: { route: "conversation", response: "Hi! I'm doing great. How can I help you?" },
    },
    {
        inputs: { message: "I need to brainstorm some ideas for a mobile app" },
        outputs: { route: "ideation", response: "Routing to ideation agent for brainstorming" },
    },
    {
        inputs: { message: "Create a project plan for the new feature" },
        outputs: { route: "planning", response: "Routing to planning agent for plan creation" },
    },
    {
        inputs: { message: "Build the login page with React" },
        outputs: { route: "execution", response: "Routing to execution agent for implementation" },
    },
    {
        inputs: { message: "Review the code I just wrote" },
        outputs: { route: "review", response: "Routing to reviewer agent for code review" },
    },
];

export const IDEATION_EXAMPLES: DatasetExample[] = [
    {
        inputs: { taskContext: "Brainstorm features for a task management app" },
        outputs: {
            questionsGenerated: 5,
            concepts: ["drag-and-drop", "collaboration", "mobile-first"],
        },
    },
    {
        inputs: { taskContext: "Explore ideas for improving user onboarding" },
        outputs: {
            questionsGenerated: 3,
            concepts: ["guided tour", "progressive disclosure", "quick wins"],
        },
    },
];

export const PLANNING_EXAMPLES: DatasetExample[] = [
    {
        inputs: { taskContext: "Create a plan for implementing user authentication" },
        outputs: {
            planSteps: 4,
            dependencies: ["database", "auth library"],
        },
    },
    {
        inputs: { taskContext: "Plan the migration from REST to GraphQL" },
        outputs: {
            planSteps: 6,
            dependencies: ["graphql server", "schema design"],
        },
    },
];

export const EXECUTION_EXAMPLES: DatasetExample[] = [
    {
        inputs: { taskContext: "Implement the login form component" },
        outputs: {
            tasksCompleted: 1,
            toolCalls: 3,
            errors: 0,
        },
    },
    {
        inputs: { taskContext: "Set up the database connection pool" },
        outputs: {
            tasksCompleted: 1,
            toolCalls: 2,
            errors: 0,
        },
    },
];

export const REVIEWER_EXAMPLES: DatasetExample[] = [
    {
        inputs: { taskContext: "Review the authentication implementation" },
        outputs: {
            reviewCompleted: true,
            feedbackPoints: 3,
            qualityScore: 0.85,
        },
    },
    {
        inputs: { taskContext: "Review the API error handling" },
        outputs: {
            reviewCompleted: true,
            feedbackPoints: 2,
            qualityScore: 0.9,
        },
    },
];

// ── Dataset Configurations ──────────────────────────────────

export const DATASET_CONFIGS: DatasetConfig[] = [
    {
        name: "baseclaw-conversation-eval",
        description: "Evaluation dataset for the Conversation Agent — routing and response quality",
        agentType: "conversation",
        examples: CONVERSATION_EXAMPLES,
    },
    {
        name: "baseclaw-ideation-eval",
        description: "Evaluation dataset for the Ideation Agent — idea generation quality",
        agentType: "ideation",
        examples: IDEATION_EXAMPLES,
    },
    {
        name: "baseclaw-planning-eval",
        description: "Evaluation dataset for the Planning Agent — plan quality",
        agentType: "planning",
        examples: PLANNING_EXAMPLES,
    },
    {
        name: "baseclaw-execution-eval",
        description: "Evaluation dataset for the Execution Agent — task completion",
        agentType: "execution",
        examples: EXECUTION_EXAMPLES,
    },
    {
        name: "baseclaw-reviewer-eval",
        description: "Evaluation dataset for the Reviewer Agent — review quality",
        agentType: "reviewer",
        examples: REVIEWER_EXAMPLES,
    },
];

/**
 * Create all agent datasets in LangSmith.
 * Skips datasets that already exist.
 */
export async function createAgentDatasets(): Promise<{
    created: string[];
    skipped: string[];
    errors: string[];
}> {
    const client = getLangSmithClient();
    const created: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    if (!client) {
        errors.push("LangSmith client not available — skipping dataset creation");
        return { created, skipped, errors };
    }

    for (const config of DATASET_CONFIGS) {
        try {
            // Check if dataset exists
            let datasetExists = false;
            try {
                for await (const ds of client.listDatasets({ datasetName: config.name })) {
                    if (ds.name === config.name) {
                        datasetExists = true;
                        break;
                    }
                }
            } catch {
                // Dataset doesn't exist — proceed to create
            }

            if (datasetExists) {
                skipped.push(config.name);
                continue;
            }

            // Create dataset
            const dataset = await client.createDataset(config.name, {
                description: config.description,
            });

            // Seed with synthetic examples
            for (const example of config.examples) {
                await client.createExample(example.inputs, example.outputs, {
                    datasetId: dataset.id,
                });
            }

            created.push(config.name);
            console.log(
                `📊 Dataset created: ${config.name} (${config.examples.length} examples)`
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`${config.name}: ${msg}`);
        }
    }

    return { created, skipped, errors };
}

/**
 * Get the dataset config for a specific agent type.
 */
export function getDatasetConfigForAgent(agentType: AgentType): DatasetConfig | undefined {
    return DATASET_CONFIGS.find((d) => d.agentType === agentType);
}
