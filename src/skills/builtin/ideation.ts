import type { SkillDefinition } from "../types.js";

/**
 * Keyword-based relevance scorer factory.
 * Returns a scorer that checks the task context for keyword matches.
 * Score = matched keywords / total keywords, clamped to [0, 1].
 */
function keywordScorer(keywords: string[]): (agentType: string, taskContext: string) => number {
    return (_agentType: string, taskContext: string): number => {
        if (!taskContext) return 0.1; // minimal baseline for empty context
        const lower = taskContext.toLowerCase();
        const matches = keywords.filter((kw) => lower.includes(kw));
        return Math.min(matches.length / Math.max(keywords.length * 0.4, 1), 1.0);
    };
}

// ── Ideation Skills ──────────────────────────────────────────

export const questionGeneration: SkillDefinition = {
    id: "ideation.question-generation",
    name: "Question Generation",
    description:
        "Generates probing questions to explore the problem space, uncover hidden requirements, and stimulate creative thinking.",
    agentTypes: ["ideation"],
    systemPromptFragment: `You have the Question Generation skill active.

When exploring ideas, systematically generate probing questions across these dimensions:
- **Why** questions: Challenge the purpose and motivation behind the idea
- **What-if** questions: Explore alternative scenarios and edge cases
- **How** questions: Investigate feasibility and implementation paths
- **Who** questions: Identify stakeholders, users, and affected parties
- **Constraint** questions: Uncover hidden limitations, dependencies, and assumptions

Generate at least 5 targeted questions per dimension that hasn't been explored yet.
Prioritize questions that challenge assumptions the user may not realize they're making.`,
    handler: async (context) => {
        return {
            output: `Generated probing questions for: ${context.taskContext}`,
            metadata: { skillId: "ideation.question-generation" },
        };
    },
    relevanceScorer: keywordScorer([
        "question", "explore", "discover", "understand", "ask", "why",
        "what if", "how", "investigate", "curious", "wonder",
    ]),
    category: "ideation",
};

export const conceptMapping: SkillDefinition = {
    id: "ideation.concept-mapping",
    name: "Concept Mapping",
    description:
        "Maps ideas into structured concept networks, showing relationships between entities and information flows.",
    agentTypes: ["ideation"],
    systemPromptFragment: `You have the Concept Mapping skill active.

When structuring ideas, create concept maps that include:
- **Core concepts**: The central entities or ideas being explored
- **Relationships**: How concepts connect (causes, enables, depends-on, part-of, contradicts)
- **Clusters**: Groups of related concepts that form subsystems
- **Gaps**: Areas where connections are missing or unclear
- **Hierarchy**: Which concepts are higher-level vs implementation details

Present the map in a clear textual format with explicit relationship labels.
Identify the most important connections and any surprising relationships.`,
    handler: async (context) => {
        return {
            output: `Mapped concepts for: ${context.taskContext}`,
            metadata: { skillId: "ideation.concept-mapping" },
        };
    },
    relevanceScorer: keywordScorer([
        "concept", "map", "relationship", "connect", "link", "structure",
        "diagram", "network", "entity", "organize", "visual",
    ]),
    category: "ideation",
};

export const assumptionProbing: SkillDefinition = {
    id: "ideation.assumption-probing",
    name: "Assumption Probing",
    description:
        "Identifies and challenges hidden assumptions that may constrain or derail the idea.",
    agentTypes: ["ideation"],
    systemPromptFragment: `You have the Assumption Probing skill active.

Actively hunt for hidden assumptions in the user's thinking:
- **Technical assumptions**: What technology constraints are being assumed?
- **Market assumptions**: What user behavior or demand is being assumed?
- **Resource assumptions**: What time, money, or team capacity is assumed?
- **Scope assumptions**: What's being implicitly included or excluded?
- **Success assumptions**: What definition of success is being assumed?

For each assumption found:
1. State the assumption explicitly
2. Rate its risk (low/medium/high) if the assumption is wrong
3. Suggest how to validate or de-risk it
4. Propose what changes if the assumption is inverted`,
    handler: async (context) => {
        return {
            output: `Probed assumptions for: ${context.taskContext}`,
            metadata: { skillId: "ideation.assumption-probing" },
        };
    },
    relevanceScorer: keywordScorer([
        "assumption", "challenge", "validate", "test", "believe", "suppose",
        "assume", "risk", "verify", "prove", "hypothesis",
    ]),
    category: "ideation",
};

export const scopeDefinition: SkillDefinition = {
    id: "ideation.scope-definition",
    name: "Scope Definition",
    description:
        "Defines clear boundaries, constraints, MVP criteria, and success metrics for an idea.",
    agentTypes: ["ideation"],
    systemPromptFragment: `You have the Scope Definition skill active.

Help define clear boundaries for the idea:
- **In scope**: What is explicitly included in the first version
- **Out of scope**: What is explicitly excluded (and why)
- **MVP criteria**: The minimum set of features for a viable first version
- **Success metrics**: Measurable outcomes that indicate success
- **Constraints**: Hard limits on time, budget, technology, or team
- **Dependencies**: External factors the idea depends on

Be specific and quantifiable wherever possible. Vague scope leads to scope creep.
Push back on "everything is important" thinking — force prioritization.`,
    handler: async (context) => {
        return {
            output: `Defined scope for: ${context.taskContext}`,
            metadata: { skillId: "ideation.scope-definition" },
        };
    },
    relevanceScorer: keywordScorer([
        "scope", "boundary", "constraint", "define", "limit", "criteria",
        "mvp", "minimum", "feature", "priority", "requirement",
    ]),
    category: "ideation",
};

/**
 * All ideation built-in skills.
 */
export const ideationSkills: SkillDefinition[] = [
    questionGeneration,
    conceptMapping,
    assumptionProbing,
    scopeDefinition,
];
