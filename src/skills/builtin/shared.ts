import type { SkillDefinition } from "../types.js";

/**
 * Keyword-based relevance scorer factory.
 */
function keywordScorer(keywords: string[]): (agentType: string, taskContext: string) => number {
    return (_agentType: string, taskContext: string): number => {
        if (!taskContext) return 0.1;
        const lower = taskContext.toLowerCase();
        const matches = keywords.filter((kw) => lower.includes(kw));
        return Math.min(matches.length / Math.max(keywords.length * 0.4, 1), 1.0);
    };
}

// ── Shared Skills ────────────────────────────────────────────
// Skills that belong to multiple agent types.

export const webSearch: SkillDefinition = {
    id: "shared.web-search",
    name: "Web Search",
    description:
        "Searches the web for information, references, and current data relevant to the task.",
    agentTypes: ["ideation", "execution"],
    systemPromptFragment: `You have the Web Search skill active.

When research or external information is needed:
- **Formulate queries**: Break complex questions into targeted search queries
- **Source evaluation**: Prioritize authoritative sources (official docs, peer-reviewed, established outlets)
- **Recency check**: Note when information might be outdated and flag it
- **Multiple perspectives**: Search for both supporting and contradicting viewpoints
- **Citation**: Always reference where information came from

Use web search when:
1. The task requires current/factual data you're not confident about
2. Technical documentation or API references are needed
3. Market data, statistics, or benchmarks are requested
4. The user asks about recent events or developments
5. You need to verify an assumption against public sources`,
    handler: async (context) => {
        return {
            output: `Prepared web search strategy for: ${context.taskContext}`,
            metadata: { skillId: "shared.web-search" },
        };
    },
    relevanceScorer: keywordScorer([
        "search", "web", "find", "lookup", "google", "research",
        "internet", "online", "browse", "reference",
    ]),
    category: "shared",
};

/**
 * All shared built-in skills.
 */
export const sharedSkills: SkillDefinition[] = [webSearch];
