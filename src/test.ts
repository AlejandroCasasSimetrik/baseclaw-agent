/**
 * Dry-run test — validates graph compilation, node structure,
 * and live routing with API key.
 */
import "dotenv/config";
import { HumanMessage } from "@langchain/core/messages";
import { buildGraph } from "./graph.js";

async function runTests() {
    console.log("🧪 Base Claw — Level 1 Verification Tests\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    let passed = 0;
    let failed = 0;

    function assert(label: string, condition: boolean, detail?: string) {
        if (condition) {
            console.log(`  ✅ ${label}`);
            passed++;
        } else {
            console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
            failed++;
        }
    }

    // ── Test 1: Graph compiles ────────────────────────────────
    console.log("Test 1: Graph compilation");
    let graph: ReturnType<typeof buildGraph> | null = null;
    try {
        graph = buildGraph();
        assert("Graph compiles without errors", true);
    } catch (e) {
        assert("Graph compiles without errors", false, String(e));
    }

    if (!graph) {
        console.log("\n💀 Cannot proceed — graph failed to compile.\n");
        process.exit(1);
    }

    // ── Test 2: Graph structure via getGraph() ────────────────
    console.log("\nTest 2: Node structure");
    try {
        const drawableGraph = graph.getGraph();
        // Use JSON representation to inspect nodes
        const graphData = JSON.parse(JSON.stringify(drawableGraph));

        // The graph should have nodes — check via the drawable representation
        assert("getGraph() returns valid graph object", !!drawableGraph);
        console.log(`  📝 Graph type: ${typeof drawableGraph}`);

        // Inspect nodes via string drawing
        const mermaid = drawableGraph.drawMermaid();
        assert("Graph can render Mermaid diagram", mermaid.length > 0);

        // Check that all 5 agent names appear in the Mermaid output
        const agents = ["conversation", "ideation", "planning", "execution", "reviewer"];
        for (const agent of agents) {
            assert(`'${agent}' node present in graph`, mermaid.includes(agent));
        }

        // Check __start__ connection
        assert("__start__ connects to conversation", mermaid.includes("__start__") && mermaid.includes("conversation"));

        console.log(`\n  📊 Mermaid diagram:\n${mermaid.split("\n").map(l => `    ${l}`).join("\n")}\n`);
    } catch (e) {
        assert("Graph structure inspection", false, String(e));
    }

    // ── Test 3: Live invocation ───────────────────────────────
    console.log("Test 3: Live invocation");
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "sk-your-openai-api-key") {
        try {
            // Test 3a: General conversation (should stay in conversation agent)
            console.log("  3a. General conversation...");
            const chatResult = await graph.invoke(
                { messages: [new HumanMessage("Hello, who are you?")] },
                { recursionLimit: 50 }
            );
            const chatMessages = chatResult.messages;
            const hasChatResponse = chatMessages.some((m: any) => m._getType() === "ai");
            assert("General chat generates AI response", hasChatResponse);
            if (hasChatResponse) {
                const lastAi = [...chatMessages].reverse().find((m: any) => m._getType() === "ai");
                console.log(`  📝 Response: "${String(lastAi?.content).slice(0, 150)}..."\n`);
            }

            // Test 3b: Ideation intent
            console.log("  3b. Ideation routing...");
            const ideaResult = await graph.invoke(
                { messages: [new HumanMessage("I have an idea for an AI-powered recipe generator")] },
                { recursionLimit: 50 }
            );
            assert("Ideation routing completes", ideaResult.messages.some((m: any) => m._getType() === "ai"));
            console.log(`  📝 Phase: "${ideaResult.phase}", Current agent: "${ideaResult.currentAgent}"\n`);

            // Test 3c: Planning intent
            console.log("  3c. Planning routing...");
            const planResult = await graph.invoke(
                { messages: [new HumanMessage("Create a step-by-step plan for building a REST API")] },
                { recursionLimit: 50 }
            );
            assert("Planning routing completes", planResult.messages.some((m: any) => m._getType() === "ai"));
            console.log(`  📝 Phase: "${planResult.phase}", Current agent: "${planResult.currentAgent}"\n`);

            // Test 3d: Execution intent
            console.log("  3d. Execution routing...");
            const execResult = await graph.invoke(
                { messages: [new HumanMessage("Implement a function that calculates fibonacci numbers")] },
                { recursionLimit: 50 }
            );
            assert("Execution routing completes", execResult.messages.some((m: any) => m._getType() === "ai"));
            console.log(`  📝 Phase: "${execResult.phase}", Current agent: "${execResult.currentAgent}"\n`);

            // Test 3e: Review intent
            console.log("  3e. Review routing...");
            const revResult = await graph.invoke(
                { messages: [new HumanMessage("Review this code for quality and potential issues")] },
                { recursionLimit: 50 }
            );
            assert("Review routing completes", revResult.messages.some((m: any) => m._getType() === "ai"));
            console.log(`  📝 Phase: "${revResult.phase}", Current agent: "${revResult.currentAgent}"\n`);

        } catch (e) {
            assert("Live invocation", false, String(e));
        }
    } else {
        console.log("  ⏭️  Skipped — OPENAI_API_KEY not set.");
    }

    // ── Summary ───────────────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
});
