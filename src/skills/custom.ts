import type { SkillDefinition } from "./types.js";
import type { SkillRegistry } from "./registry.js";

/**
 * Register a custom skill into the registry.
 *
 * Custom skills follow the EXACT same interface as built-in skills.
 * There is no architectural difference at runtime.
 *
 * @param registry - The skill registry to add the custom skill to
 * @param skill - The custom skill definition (same interface as built-in)
 */
export function registerCustomSkill(
    registry: SkillRegistry,
    skill: SkillDefinition
): void {
    // Validate the skill definition has all required fields
    if (!skill.id || !skill.name || !skill.description) {
        throw new Error(
            `Custom skill registration failed: missing required fields (id, name, description)`
        );
    }
    if (!skill.agentTypes || skill.agentTypes.length === 0) {
        throw new Error(
            `Custom skill "${skill.id}" must specify at least one agentType`
        );
    }
    if (typeof skill.handler !== "function") {
        throw new Error(
            `Custom skill "${skill.id}" must have a handler function`
        );
    }
    if (typeof skill.relevanceScorer !== "function") {
        throw new Error(
            `Custom skill "${skill.id}" must have a relevanceScorer function`
        );
    }
    if (!skill.systemPromptFragment) {
        throw new Error(
            `Custom skill "${skill.id}" must have a systemPromptFragment`
        );
    }

    registry.register(skill);
}

// ── Example Custom Skill ─────────────────────────────────────
/**
 * Example custom skill: Sentiment Analysis
 *
 * Demonstrates the custom skill pattern. Available to reviewer
 * and conversation agents.
 */
export const exampleSentimentSkill: SkillDefinition = {
    id: "custom.sentiment-analysis",
    name: "Sentiment Analysis",
    description:
        "Analyzes the emotional tone and sentiment of text, providing structured sentiment breakdowns.",
    agentTypes: ["reviewer", "conversation"],
    systemPromptFragment: `You have the Sentiment Analysis skill active.

When analyzing sentiment in text:
- **Overall tone**: Positive / Neutral / Negative with confidence score
- **Emotional dimensions**: Joy, anger, sadness, fear, surprise, trust (0-1 each)
- **Intensity**: How strong is the sentiment? (mild / moderate / strong)
- **Subjectivity**: How objective vs subjective is the text? (0-1 scale)
- **Key phrases**: Which specific phrases carry the most emotional weight?

Provide structured output:
| Dimension | Score | Evidence |
|-----------|-------|----------|
| Overall   | +0.7  | "excited about the new features" |
| Joy       | 0.8   | "love the design" |
| ...       | ...   | ... |`,
    handler: async (context) => {
        const text = context.taskContext || "No text provided";
        // Simple keyword-based sentiment (demonstration)
        const positiveWords = ["good", "great", "love", "excellent", "happy", "excited"];
        const negativeWords = ["bad", "terrible", "hate", "awful", "angry", "frustrated"];

        const lower = text.toLowerCase();
        const posCount = positiveWords.filter((w) => lower.includes(w)).length;
        const negCount = negativeWords.filter((w) => lower.includes(w)).length;

        let sentiment: string;
        if (posCount > negCount) sentiment = "positive";
        else if (negCount > posCount) sentiment = "negative";
        else sentiment = "neutral";

        return {
            output: `Sentiment analysis result: ${sentiment} (positive signals: ${posCount}, negative signals: ${negCount})`,
            metadata: {
                skillId: "custom.sentiment-analysis",
                sentiment,
                positiveCount: posCount,
                negativeCount: negCount,
            },
        };
    },
    relevanceScorer: (_agentType: string, taskContext: string): number => {
        if (!taskContext) return 0.05;
        const keywords = ["sentiment", "emotion", "tone", "feeling", "mood", "happy", "angry"];
        const lower = taskContext.toLowerCase();
        const matches = keywords.filter((kw) => lower.includes(kw));
        return Math.min(matches.length / 2, 1.0);
    },
    category: "custom",
};
