import type { Config } from "../../config/schema.js";
import { openEditor } from "../shared.js";

export async function handleConfig(config: Config, args: string[]): Promise<void> {
	const subCommand = args[0];

	if (subCommand === "open") {
		await openEditor();
		return;
	}

	console.log("Current Configuration:");
	console.log(`  Default Model: ${config.defaultModel}`);

	if (config.systemPrompt) {
		console.log(`  System Prompt: ${config.systemPrompt}`);
	}

	if (config.conversationFile) {
		console.log(`  Conversation File: ${config.conversationFile}`);
	}

	if (config.maxContextTokens) {
		console.log(`  Max Context Tokens: ${config.maxContextTokens}`);
	}

	if (config.memoryFile) {
		console.log(`  Memory File: ${config.memoryFile}`);
	}

	if (config.maxMemoryTokens) {
		console.log(`  Max Memory Tokens: ${config.maxMemoryTokens}`);
	}

	if (config.trackContextUsage) {
		console.log(`  Track Context Usage: true`);
	}

	console.log("\n  Providers:");
	console.log(`    OpenAI: ${config.providers.openai ? "configured" : "not configured"}`);
	console.log(`    Anthropic: ${config.providers.anthropic ? "configured" : "not configured"}`);
	console.log(`    Ollama: ${config.providers.ollama ? "configured" : "not configured"}`);
	console.log(`    OllamaCloud: ${config.providers.ollamaCloud ? "configured" : "not configured"}`);
	console.log(`    OpenCode: ${config.providers.opencode ? "configured" : "not configured"}`);
	console.log(`    Zai: ${config.providers.zai ? "configured" : "not configured"}`);

	const mcpEntries = Object.entries(config.mcpServers ?? {});
	if (mcpEntries.length > 0) {
		console.log("\n  MCP Servers:");
		for (const [name] of mcpEntries) {
			console.log(`    - ${name}`);
		}
	}
	process.exit(0);
}
