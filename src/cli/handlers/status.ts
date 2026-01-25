import type { Config } from "../../config/schema.js";
import type { ModelCapabilities } from "../../providers/capabilities.js";
import { OpenAIProvider } from "../../providers/openai.js";
import { AnthropicProvider } from "../../providers/anthropic.js";
import { OllamaProvider } from "../../providers/ollama.js";
import { OpenRouterProvider } from "../../providers/openrouter.js";
import { OpenCodeProvider } from "../../providers/opencode.js";
import { createLLMClient, setupTools } from "../shared.js";

interface StatusHandlerOptions {
  model?: string;
}

export async function handleStatus(config: Config, options: StatusHandlerOptions): Promise<void> {
  const llmClient = await createLLMClient(config, options);
  const { registry: toolRegistry } = await setupTools(config);
  const model = options.model || config.defaultModel;

  console.log("\n🤖 Tiny Agent Status");
  console.log("===================\n");

  console.log("Configuration:");
  console.log(`  Model: ${model}`);

  const providerName = (() => {
    if (llmClient instanceof OpenAIProvider) {
      const baseUrl = config.providers.openai?.baseUrl;
      return baseUrl ? `OpenAI (${baseUrl})` : "OpenAI";
    }
    if (llmClient instanceof AnthropicProvider) return "Anthropic";
    if (llmClient instanceof OllamaProvider) {
      const baseUrl = config.providers.ollama?.baseUrl ?? "http://localhost:11434";
      return `Ollama (${baseUrl})`;
    }
    if (llmClient instanceof OpenRouterProvider) {
      const baseUrl = config.providers.openrouter?.baseUrl ?? "https://openrouter.ai/api/v1";
      return `OpenRouter (${baseUrl})`;
    }
    if (llmClient instanceof OpenCodeProvider) {
      const baseUrl = config.providers.opencode?.baseUrl ?? "https://opencode.ai/zen/v1";
      return `OpenCode (${baseUrl})`;
    }
    return "Unknown";
  })();
  console.log(`  Provider: ${providerName}\n`);

  const capabilities: ModelCapabilities = await llmClient.getCapabilities(model);

  console.log("Model Capabilities:");
  const capabilityCheck = (_name: string, supported: boolean): string =>
    supported ? "[✓]" : "[✗]";

  console.log(`${capabilityCheck("Tools", capabilities.supportsTools)} Tools`);
  console.log(`${capabilityCheck("Streaming", capabilities.supportsStreaming)} Streaming`);
  console.log(
    `${capabilityCheck("System Prompts", capabilities.supportsSystemPrompt)} System Prompts`,
  );
  console.log(
    `${capabilityCheck("Tool Streaming", capabilities.supportsToolStreaming)} Tool Streaming`,
  );
  console.log(`${capabilityCheck("Thinking", capabilities.supportsThinking)} Thinking`);

  if (capabilities.contextWindow) {
    console.log(`  Context Window: ${(capabilities.contextWindow / 1000).toFixed(0)}k tokens`);
  }
  if (capabilities.maxOutputTokens) {
    console.log(`  Max Output: ${capabilities.maxOutputTokens} tokens`);
  }

  console.log("\nTool Registry:");
  const tools = toolRegistry.list();
  console.log(`  ${tools.length} tools registered`);
  if (tools.length > 0) {
    const toolNames = tools.map((t) => t.name).sort();
    console.log(`  ${toolNames.join(", ")}`);
  }

  const mcpEntries = Object.entries(config.mcpServers ?? {});
  if (mcpEntries.length > 0) {
    console.log("\nMCP Servers:");
    for (const [name] of mcpEntries) {
      console.log(`  - ${name}`);
    }
  }

  console.log();
  process.exit(0);
}
