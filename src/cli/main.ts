import * as readline from "node:readline";
import { loadConfig } from "../config/loader.js";
import { OpenAIProvider } from "../providers/openai.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OllamaProvider } from "../providers/ollama.js";
import type { LLMClient } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { fileTools, bashTool, searchTools, webSearchTool, loadPlugins } from "../tools/index.js";
import { Agent } from "../core/agent.js";
import { McpManager } from "../mcp/manager.js";
import type { ModelCapabilities } from "../providers/capabilities.js";

interface CliOptions {
  model?: string;
  provider?: string;
  verbose?: boolean;
  save?: boolean;
  help?: boolean;
}

function parseArgs(): {
  command: string;
  args: string[];
  options: CliOptions;
} {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--model" && i + 1 < args.length) {
      const nextArg = args[i + 1];
      if (nextArg !== undefined) {
        options.model = nextArg;
        i++;
      }
    } else if (arg === "--provider" && i + 1 < args.length) {
      const nextArg = args[i + 1];
      if (nextArg !== undefined) {
        options.provider = nextArg;
        i++;
      }
    } else if (arg === "-v" || arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--save") {
      options.save = true;
    } else if (!arg.startsWith("-")) {
      positionalArgs.push(arg);
    }
  }

  const command = positionalArgs[0] || "chat";
  const commandArgs = positionalArgs.slice(1);

  return { command, args: commandArgs, options };
}

async function createLLMClient(
  config: ReturnType<typeof loadConfig>,
  options: CliOptions,
): Promise<LLMClient> {
  // Determine model and provider
  const model = options.model || config.defaultModel;
  let provider: LLMClient;

  // If provider is explicitly set, use that
  if (options.provider) {
    const providerName = options.provider.toLowerCase();
    if (providerName === "openai" || providerName.startsWith("openai-")) {
      const apiKey = config.providers.openai?.apiKey;
      if (!apiKey) {
        throw new Error(
          "OpenAI API key not configured. Set it in config or OPENAI_API_KEY env var",
        );
      }
      provider = new OpenAIProvider({
        apiKey,
        baseUrl: config.providers.openai?.baseUrl,
      });
    } else if (providerName === "anthropic") {
      const apiKey = config.providers.anthropic?.apiKey;
      if (!apiKey) {
        throw new Error(
          "Anthropic API key not configured. Set it in config or ANTHROPIC_API_KEY env var",
        );
      }
      provider = new AnthropicProvider({ apiKey });
    } else if (providerName === "ollama") {
      provider = new OllamaProvider({
        baseUrl: config.providers.ollama?.baseUrl,
      });
    } else {
      throw new Error(`Unknown provider: ${providerName}`);
    }
  } else {
    // Auto-detect provider from model name
    if (model.includes("gpt") || model.includes("o1")) {
      const apiKey = config.providers.openai?.apiKey;
      if (!apiKey) {
        throw new Error(
          "OpenAI API key not configured for GPT models. Set it in config or OPENAI_API_KEY env var",
        );
      }
      provider = new OpenAIProvider({
        apiKey,
        baseUrl: config.providers.openai?.baseUrl,
      });
    } else if (model.includes("claude")) {
      const apiKey = config.providers.anthropic?.apiKey;
      if (!apiKey) {
        throw new Error(
          "Anthropic API key not configured for Claude models. Set it in config or ANTHROPIC_API_KEY env var",
        );
      }
      provider = new AnthropicProvider({ apiKey });
    } else {
      // Default to Ollama for local models
      provider = new OllamaProvider({
        baseUrl: config.providers.ollama?.baseUrl,
      });
    }
  }

  return provider;
}

async function setupTools(config: ReturnType<typeof loadConfig>): Promise<ToolRegistry> {
  const registry = new ToolRegistry();

  const isToolEnabled = (name: string): boolean => {
    if (config.tools === undefined) {
      return true;
    }
    const toolConfig = config.tools[name];
    return toolConfig === undefined || toolConfig.enabled === true;
  };

  // Register built-in tools if enabled
  for (const tool of fileTools) {
    if (isToolEnabled(tool.name)) {
      registry.register(tool);
    }
  }
  if (isToolEnabled(bashTool.name)) {
    registry.register(bashTool);
  }
  for (const tool of searchTools) {
    if (isToolEnabled(tool.name)) {
      registry.register(tool);
    }
  }
  if (isToolEnabled(webSearchTool.name)) {
    registry.register(webSearchTool);
  }

  // Load and register plugins
  try {
    const plugins = await loadPlugins();
    for (const tool of plugins) {
      if (isToolEnabled(tool.name)) {
        registry.register(tool);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Warning: Failed to load plugins: ${message}`);
  }

  // Initialize and register MCP tools if configured
  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    const mcpManager = new McpManager();
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      await mcpManager.addServer(serverName, serverConfig);
    }
    const allMcpTools = mcpManager.getAllTools();
    for (const [serverName, toolDefs] of allMcpTools) {
      for (const toolDef of toolDefs) {
        const tool = mcpManager.createToolFromMcp(serverName, toolDef);
        if (isToolEnabled(tool.name)) {
          try {
            registry.register(tool);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Warning: Failed to register MCP tool: ${message}`);
          }
        }
      }
    }
  }

  return registry;
}

async function handleChat(
  config: ReturnType<typeof loadConfig>,
  options: CliOptions,
): Promise<void> {
  const llmClient = await createLLMClient(config, options);
  const toolRegistry = await setupTools(config);
  const model = options.model || config.defaultModel;

  const agent = new Agent(llmClient, toolRegistry, {
    verbose: options.verbose,
    systemPrompt: config.systemPrompt,
    conversationFile: options.save ? config.conversationFile || "conversation.json" : undefined,
    maxContextTokens: config.maxContextTokens,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`Tiny Coding Agent (model: ${model})`);
  console.log('Type "exit" to quit\n');

  const askQuestion = (): void => {
    rl.question("You: ", async (userInput: string) => {
      if (userInput.toLowerCase() === "exit") {
        rl.close();
        console.log("Goodbye!");
        process.exit(0);
        return;
      }

      if (!userInput.trim()) {
        askQuestion();
        return;
      }

      try {
        process.stdout.write("\nAgent: ");
        for await (const chunk of agent.runStream(userInput, model)) {
          if (chunk.content) {
            process.stdout.write(chunk.content);
          }

          if (chunk.toolExecutions) {
            for (const te of chunk.toolExecutions) {
              if (te.status === "running") {
                process.stdout.write(`\n[${te.name}...]`);
              } else if (te.status === "complete") {
                process.stdout.write(`\r[${te.name}✓]`);
              } else if (te.status === "error") {
                process.stdout.write(`\r[${te.name}✗]`);
              }
            }
            process.stdout.write("\nAgent: ");
          }

          if (chunk.done) {
            process.stdout.write("\n\n");
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${message}\n`);
      }

      askQuestion();
    });
  };

  askQuestion();
}

async function handleRun(
  config: ReturnType<typeof loadConfig>,
  args: string[],
  options: CliOptions,
): Promise<void> {
  const prompt = args.join(" ");
  if (!prompt) {
    console.error("Error: run command requires a prompt");
    process.exit(1);
  }

  const llmClient = await createLLMClient(config, options);
  const toolRegistry = await setupTools(config);
  const model = options.model || config.defaultModel;

  const agent = new Agent(llmClient, toolRegistry, {
    verbose: options.verbose,
    systemPrompt: config.systemPrompt,
    conversationFile: options.save ? config.conversationFile || "conversation.json" : undefined,
    maxContextTokens: config.maxContextTokens,
  });

  try {
    for await (const chunk of agent.runStream(prompt, model)) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
      }

      if (chunk.toolExecutions) {
        for (const te of chunk.toolExecutions) {
          if (te.status === "running") {
            process.stdout.write(`\n[${te.name}...]`);
          } else if (te.status === "complete") {
            process.stdout.write(`\r[${te.name}✓]`);
          } else if (te.status === "error") {
            process.stdout.write(`\r[${te.name}✗]`);
          }
        }
      }
    }
    process.stdout.write("\n");
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${message}`);
    process.exit(1);
  }
}

async function handleStatus(
  config: ReturnType<typeof loadConfig>,
  options: CliOptions,
): Promise<void> {
  const llmClient = await createLLMClient(config, options);
  const toolRegistry = await setupTools(config);
  const model = options.model || config.defaultModel;

  console.log("\n🤖 Tiny Agent Status");
  console.log("===================\n");

  console.log("Configuration:");
  console.log(`  Model: ${model}`);

  const providerName = (() => {
    if (llmClient instanceof OllamaProvider) {
      const baseUrl = config.providers.ollama?.baseUrl ?? "http://localhost:11434";
      return `Ollama (${baseUrl})`;
    }
    if (llmClient instanceof AnthropicProvider) {
      return "Anthropic";
    }
    if (llmClient instanceof OpenAIProvider) {
      const baseUrl = config.providers.openai?.baseUrl;
      return baseUrl ? `OpenAI (${baseUrl})` : "OpenAI";
    }
    return "Unknown";
  })();
  console.log(`  Provider: ${providerName}\n`);

  const capabilities: ModelCapabilities = await llmClient.getCapabilities(model);

  console.log("Model Capabilities:");
  const capabilityCheck = (name: string, supported: boolean): string => {
    return supported ? "  ✓" : "  ✗";
  };

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

  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    console.log("\nMCP Servers:");
    for (const [name] of Object.entries(config.mcpServers)) {
      console.log(`  - ${name}`);
    }
  }

  console.log();
  process.exit(0);
}

function showHelp(): void {
  console.log(`
    ╔════════════════════════════════════════════════╗
    ║                                                ║
    ║            ◯                                   ║
    ║            │                                   ║
    ║     ┌──────┴──────┐                            ║
    ║     │  <      />  │   TINY CODING AGENT        ║
    ║     │             │                            ║
    ║     │     ___     │                            ║
    ║     └──────┴──────┘                            ║
    ║                                                ║
    ╚════════════════════════════════════════════════╝

A lightweight, extensible coding agent built in TypeScript.

USAGE:
    tiny-agent [command] [args...]     Run a command
    tiny-agent chat                    Interactive chat mode (default)
    tiny-agent run <prompt>            Run a single prompt
    tiny-agent config                  Show current configuration
    tiny-agent status                  Show provider and model capabilities

OPTIONS:
    --model <model>                    Override default model
    --provider <provider>              Override provider (openai|anthropic|ollama)
    --verbose, -v                      Enable verbose logging
    --save                             Save conversation to file
    --help, -h                         Show this help message

EXAMPLES:
    tiny-agent                         Start interactive chat
    tiny-agent chat                    Start interactive chat explicitly
    tiny-agent run "Fix this bug"      Run a single prompt
    tiny-agent run --model claude-3-5-sonnet "Help me"  Use specific model
    tiny-agent config                  Show current configuration
    tiny-agent status                  Show provider and model capabilities
    tiny-agent --help                  Show this help message

CONFIG:
    ~/.tiny-agent/config.yaml          Configuration file

For more information, visit: https://github.com/anomalyco/tiny-agent
  `);
}

async function handleConfig(config: ReturnType<typeof loadConfig>): Promise<void> {
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

  console.log("\n  Providers:");
  console.log(`    OpenAI: ${config.providers.openai ? "configured" : "not configured"}`);
  console.log(`    Anthropic: ${config.providers.anthropic ? "configured" : "not configured"}`);
  console.log(`    Ollama: ${config.providers.ollama ? "configured" : "not configured"}`);

  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    console.log("\n  MCP Servers:");
    for (const [name] of Object.entries(config.mcpServers)) {
      console.log(`    - ${name}`);
    }
  }
  process.exit(0);
}

export async function main(): Promise<void> {
  try {
    const { command, args, options } = parseArgs();

    if (options.help) {
      showHelp();
      process.exit(0);
    }

    const config = loadConfig();

    if (command === "chat") {
      await handleChat(config, options);
    } else if (command === "run") {
      await handleRun(config, args, options);
    } else if (command === "config") {
      await handleConfig(config);
    } else if (command === "status") {
      await handleStatus(config, options);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: chat, run <prompt>, config, status");
      console.error("Options: --model <model>, --provider <provider>, --verbose, --save, --help");
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
