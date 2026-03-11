import "dotenv/config";
import * as readline from "node:readline";
import { HumanMessage } from "@langchain/core/messages";
import { initializeTracing } from "./tracing.js";
import { buildGraph } from "./graph.js";
import {
    SkillRegistry,
    registerBuiltinSkills,
    registerCustomSkill,
    exampleSentimentSkill,
} from "./skills/index.js";
import {
    MCPServerRegistry,
    loadMCPConfig,
    registerServersFromConfig,
} from "./mcp/index.js";
import { getDefaultVoiceConfig } from "./voice/config.js";

// ── Initialize ─────────────────────────────────────────────
initializeTracing();

// ── Skill Registry ─────────────────────────────────────────
const registry = new SkillRegistry();
registerBuiltinSkills(registry);
registerCustomSkill(registry, exampleSentimentSkill);
console.log(
    `📦 Skill Registry loaded: ${registry.getAllSkills().length} skills registered`
);

// ── MCP Server Registry ────────────────────────────────────
const mcpRegistry = new MCPServerRegistry();
try {
    const mcpConfigs = loadMCPConfig();
    const registered = registerServersFromConfig(mcpRegistry, mcpConfigs);
    console.log(
        `🔌 MCP Registry loaded: ${registered.length} servers registered`
    );
} catch {
    console.log("🔌 MCP Registry: no config file found, starting empty");
}

// ── Voice I/O (Level 7) ────────────────────────────────────
const voiceConfig = getDefaultVoiceConfig("default");
console.log(
    `🎤 Voice I/O: STT=${voiceConfig.sttProvider}, TTS=${voiceConfig.ttsEnabled ? "enabled" : "disabled"}`
);

const graph = buildGraph();

console.log("\n🦀 Base Claw — Multi-Agent System");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Type your message and press Enter. Ctrl+C to exit.\n");

// ── CLI readline loop ──────────────────────────────────────
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function prompt(): void {
    rl.question("You: ", async (input) => {
        const trimmed = input.trim();

        if (!trimmed) {
            prompt();
            return;
        }

        try {
            const result = await graph.invoke(
                {
                    messages: [new HumanMessage(trimmed)],
                },
                {
                    recursionLimit: 50,
                }
            );

            // Get the last AI message from state
            const messages = result.messages;
            const lastAiMessage = [...messages]
                .reverse()
                .find((m: any) => m._getType() === "ai");

            if (lastAiMessage) {
                console.log(`\n🤖 Base Claw: ${lastAiMessage.content}\n`);
            } else {
                console.log("\n🤖 Base Claw: [No response generated]\n");
            }
        } catch (error) {
            if (error instanceof Error) {
                console.error(`\n❌ Error: ${error.message}\n`);
            } else {
                console.error("\n❌ An unexpected error occurred\n");
            }
        }

        prompt();
    });
}

// Graceful shutdown
rl.on("close", () => {
    console.log("\n\n👋 Base Claw shutting down. Goodbye!\n");
    process.exit(0);
});

// Start the loop
prompt();
