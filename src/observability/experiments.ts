/**
 * Level 4 — Experiment Runner
 *
 * Wraps LangSmith's evaluate() function with BaseClaw-specific
 * configuration. Runs evaluators against datasets and collects results.
 */

import { evaluate } from "langsmith/evaluation";
import { getLangSmithClient } from "./trace-config.js";
import type { EvaluatorResult, EvaluatorInput } from "./evaluators.js";

// ── Types ───────────────────────────────────────────────────

export interface ExperimentConfig {
    /** Name prefix for the experiment */
    name: string;
    /** LangSmith dataset name to evaluate against */
    datasetName: string;
    /** Target function to evaluate */
    targetFn: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>;
    /** Evaluator functions */
    evaluators: Array<(input: EvaluatorInput) => Promise<EvaluatorResult>>;
    /** Optional metadata */
    metadata?: Record<string, unknown>;
}

export interface ExperimentResults {
    experimentName: string;
    datasetName: string;
    resultCount: number;
    averageScores: Record<string, number>;
}

/**
 * Run an evaluation experiment against a LangSmith dataset.
 *
 * Wraps the LangSmith evaluate() function with BaseClaw-specific defaults.
 */
export async function runExperiment(config: ExperimentConfig): Promise<ExperimentResults> {
    const client = getLangSmithClient();

    if (!client) {
        throw new Error(
            "LangSmith client not available — cannot run experiments. Set LANGCHAIN_API_KEY in .env."
        );
    }

    // Convert our evaluator format to LangSmith format
    const lsEvaluators = config.evaluators.map((evalFn) => {
        return async (run: any, example: any) => {
            const result = await evalFn({
                inputs: example?.inputs ?? {},
                outputs: run?.outputs ?? {},
                referenceOutputs: example?.outputs,
            });
            return {
                key: result.key,
                score: result.score,
                comment: result.comment,
            };
        };
    });

    const results = await evaluate(config.targetFn, {
        data: config.datasetName,
        evaluators: lsEvaluators,
        experimentPrefix: config.name,
        metadata: {
            ...config.metadata,
            source: "baseclaw-level4",
        },
    });

    // Aggregate results
    const scoreAccumulators: Record<string, { total: number; count: number }> = {};
    let resultCount = 0;

    for (const row of results.results) {
        resultCount++;
        if (row.evaluationResults?.results) {
            for (const evalResult of row.evaluationResults.results) {
                const key = evalResult.key ?? "unknown";
                if (!scoreAccumulators[key]) {
                    scoreAccumulators[key] = { total: 0, count: 0 };
                }
                scoreAccumulators[key].total += Number(evalResult.score ?? 0);
                scoreAccumulators[key].count++;
            }
        }
    }

    const averageScores: Record<string, number> = {};
    for (const [key, acc] of Object.entries(scoreAccumulators)) {
        averageScores[key] = acc.count > 0 ? acc.total / acc.count : 0;
    }

    return {
        experimentName: results.experimentName,
        datasetName: config.datasetName,
        resultCount,
        averageScores,
    };
}
