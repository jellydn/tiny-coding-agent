import * as readline from "node:readline";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadConfig, getConfigPath } from "../config/loader.js";
import { OpenAIProvider } from "../providers/openai.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OllamaProvider } from "../providers/ollama.js";
import type { LLMClient } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { fileTools, bashTool, searchTools, webSearchTool, loadPlugins } from "../tools/index.js";
import { Agent } from "../core/agent.js";
import { McpManager } from "../mcp/manager.js";
import type { ModelCapabilities } from "../providers/capabilities.js";
import { MemoryStore } from "../core/memory.js";

interface CliOptions {
  model?: string;
  provider?: string;
  verbose?: boolean;
  save?: boolean;
  help?: boolean;
  noMemory?: boolean;
  noTrackContext?: boolean;
  memoryFile?: string;
  agentsMd?: string;
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
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--model" && i + 1 < args.length) {
      options.model = args[i + 1];
      i++;
    } else if (arg === "--provider" && i + 1 < args.length) {
      options.provider = args[i + 1];
      i++;
    } else if (arg === "-v" || arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--save") {
      options.save = true;
    } else if (arg === "--no-memory") {
      options.noMemory = true;
    } else if (arg === "--no-track-context") {
      options.noTrackContext = true;
    } else if (arg === "--agents-md" && i + 1 < args.length) {
      options.agentsMd = args[i + 1];
      i++;
    } else if (arg && !arg.startsWith("-")) {
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
        apiKey: config.providers.ollama?.apiKey,
      });
    } else {
      throw new Error(`Unknown provider: ${providerName}`);
    }
  } else {
    // Auto-detect provider from model name
    // Check for Ollama Cloud models first (suffix -oss indicates Ollama Cloud)
    if (model.includes("-oss") || config.providers.ollama?.apiKey) {
      provider = new OllamaProvider({
        baseUrl: config.providers.ollama?.baseUrl,
        apiKey: config.providers.ollama?.apiKey,
      });
    } else if (model.includes("gpt") || model.includes("o1")) {
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

function createMemoryStore(
  config: ReturnType<typeof loadConfig>,
  options: CliOptions,
): MemoryStore | undefined {
  const memoryFile = options.memoryFile || config.memoryFile;
  if (!memoryFile && !options.noMemory) {
    return undefined;
  }
  return new MemoryStore({
    filePath: memoryFile || `${process.env.HOME}/.tiny-agent/memories.json`,
  });
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

  const enableMemory = !options.noMemory || config.memoryFile !== undefined;
  const maxContextTokens = config.maxContextTokens ?? (enableMemory ? 32000 : undefined);

  const agentsMdPath =
    options.agentsMd ??
    (existsSync(join(process.cwd(), "AGENTS.md")) ? join(process.cwd(), "AGENTS.md") : undefined);

  const agent = new Agent(llmClient, toolRegistry, {
    verbose: options.verbose,
    systemPrompt: config.systemPrompt,
    conversationFile: options.save ? config.conversationFile || "conversation.json" : undefined,
    maxContextTokens,
    memoryFile: enableMemory
      ? config.memoryFile || `${process.env.HOME}/.tiny-agent/memories.json`
      : undefined,
    maxMemoryTokens: config.maxMemoryTokens,
    trackContextUsage: !options.noTrackContext || config.trackContextUsage,
    agentsMdPath,
    thinking: config.thinking,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`Tiny Coding Agent (model: ${model})`);

  const toolCount = toolRegistry.list().length;
  const memoryStatus = enableMemory ? "enabled" : "disabled";
  const agentsMdStatus = agentsMdPath ? `AGENTS.md loaded` : "no AGENTS.md";
  console.log(`[${toolCount} tools, ${memoryStatus}, ${agentsMdStatus}]`);
  console.log('Type "exit" to quit\n');

  const askQuestion = (): void => {
    rl.question("You: ", async (userInput: string) => {
      if (userInput.toLowerCase() === "exit") {
        rl.close();
        console.log("Goodbye!");
        process.exit(0);
      }

      if (!userInput.trim()) {
        askQuestion();
        return;
      }

      try {
        process.stdout.write("\n");
        let hasContent = false;
        for await (const chunk of agent.runStream(userInput, model)) {
          if (chunk.content) {
            process.stdout.write(chunk.content);
            hasContent = true;
          }

          if (chunk.toolExecutions) {
            process.stdout.write("\n");
            for (const te of chunk.toolExecutions) {
              if (te.status === "running") {
                process.stdout.write(`[${te.name}...]\n`);
              } else if (te.status === "complete") {
                process.stdout.write(`[${te.name}✓]\n`);
              } else if (te.status === "error") {
                process.stdout.write(`[${te.name}✗]\n`);
              }
            }
            if (!options.noTrackContext && chunk.contextStats) {
              const ctx = chunk.contextStats;
              process.stdout.write(
                `[Context: ${ctx.totalTokens}/${ctx.maxContextTokens} - ` +
                  `sys: ${ctx.systemPromptTokens}t, mem: ${ctx.memoryTokens}t, conv: ${ctx.conversationTokens}t]\n`,
              );
            }
            if (!hasContent) {
              process.stdout.write("Agent: ");
            }
          }

          if (chunk.done) {
            process.stdout.write("\n");
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

  const enableMemory = !options.noMemory || config.memoryFile !== undefined;
  const maxContextTokens = config.maxContextTokens ?? (enableMemory ? 32000 : undefined);

  const agentsMdPath =
    options.agentsMd ??
    (existsSync(join(process.cwd(), "AGENTS.md")) ? join(process.cwd(), "AGENTS.md") : undefined);

  const agent = new Agent(llmClient, toolRegistry, {
    verbose: options.verbose,
    systemPrompt: config.systemPrompt,
    conversationFile: options.save ? config.conversationFile || "conversation.json" : undefined,
    maxContextTokens,
    memoryFile: enableMemory
      ? config.memoryFile || `${process.env.HOME}/.tiny-agent/memories.json`
      : undefined,
    maxMemoryTokens: config.maxMemoryTokens,
    trackContextUsage: !options.noTrackContext || config.trackContextUsage,
    agentsMdPath,
    thinking: config.thinking,
  });

  const toolCount = toolRegistry.list().length;
  const memoryStatus = enableMemory ? "memory enabled" : "no memory";
  const agentsMdStatus = agentsMdPath ? "AGENTS.md loaded" : "";
  console.log(
    `[${toolCount} tools, ${memoryStatus}${agentsMdStatus ? `, ${agentsMdStatus}` : ""}]`,
  );

  try {
    for await (const chunk of agent.runStream(prompt, model)) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
      }

      if (chunk.toolExecutions) {
        process.stdout.write("\n");
        for (const te of chunk.toolExecutions) {
          if (te.status === "running") {
            process.stdout.write(`[${te.name}...]\n`);
          } else if (te.status === "complete") {
            process.stdout.write(`[${te.name}✓]\n`);
          } else if (te.status === "error") {
            process.stdout.write(`[${te.name}✗]\n`);
          }
        }
        if (!options.noTrackContext && chunk.contextStats) {
          const ctx = chunk.contextStats;
          process.stdout.write(
            `[Context: ${ctx.totalTokens}/${ctx.maxContextTokens} - ` +
              `sys: ${ctx.systemPromptTokens}t, mem: ${ctx.memoryTokens}t, conv: ${ctx.conversationTokens}t]\n`,
          );
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

function openEditor(): void {
  const configPath = getConfigPath();

  const editor = process.env.EDITOR || process.env.VISUAL || "code";
  const editorArgs: string[] = [];

  if (editor === "code") {
    editorArgs.push("--wait");
  }

  editorArgs.push(configPath);

  const proc = spawn(editor, editorArgs, {
    stdio: "inherit",
    shell: true,
  });

  proc.on("error", (err) => {
    console.error(`Failed to open editor: ${err.message}`);
    console.error(`Config file: ${configPath}`);
    process.exit(1);
  });

  proc.on("close", (code) => {
    process.exit(code);
  });
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
    tiny-agent config open             Open config file in editor
    tiny-agent status                  Show provider and model capabilities
    tiny-agent memory [command]        Manage memories

COMMANDS:
    memory list                        List all stored memories
    memory add <content>               Add a new memory
    memory clear                       Clear all memories
    memory stats                       Show memory statistics

OPTIONS:
    --model <model>                    Override default model
    --provider <provider>              Override provider (openai|anthropic|ollama)
    --verbose, -v                      Enable verbose logging
    --save                             Save conversation to file
    --no-memory                        Disable memory (enabled by default)
    --no-track-context                 Disable context tracking (enabled by default)
    --agents-md <path>                 Path to AGENTS.md file (auto-detected in cwd)
    --help, -h                         Show this help message

EXAMPLES:
    tiny-agent                         Start interactive chat
    tiny-agent chat                    Start interactive chat explicitly
    tiny-agent run "Fix this bug"      Run a single prompt
    tiny-agent run --model claude-3-5-sonnet "Help me"  Use specific model
    tiny-agent config                  Show current configuration
    tiny-agent config open             Open config file in editor
    tiny-agent status                  Show provider and model capabilities
    tiny-agent --help                  Show this help message
    tiny-agent --no-memory run "Help me"  Run without memory
    tiny-agent --no-track-context run "Help me"  Run without context tracking
    tiny-agent --agents-md ./AGENTS.md run "Help me"  Run with AGENTS.md
    tiny-agent memory add "I prefer TypeScript"  Add a memory
    tiny-agent memory list             List all memories

CONFIG:
    ~/.tiny-agent/config.yaml          Configuration file
    tiny-agent config open             Open config in editor

For more information, visit: https://github.com/anomalyco/tiny-agent
  `);
}

async function handleConfig(config: ReturnType<typeof loadConfig>, args: string[]): Promise<void> {
  const subCommand = args[0];

  if (subCommand === "open") {
    openEditor();
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

  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    console.log("\n  MCP Servers:");
    for (const [name] of Object.entries(config.mcpServers)) {
      console.log(`    - ${name}`);
    }
  }
  process.exit(0);
}

async function handleMemory(
  config: ReturnType<typeof loadConfig>,
  args: string[],
  options: CliOptions,
): Promise<void> {
  let memoryStore = createMemoryStore(config, options);
  const subCommand = args[0] || "list";

  if (!memoryStore) {
    const memoryFile = config.memoryFile || `${process.env.HOME}/.tiny-agent/memories.json`;
    memoryStore = new MemoryStore({ filePath: memoryFile });
    console.log(`Using memory file: ${memoryFile}\n`);
  }

  if (subCommand === "list") {
    const memories = memoryStore.list();
    console.log("\nMemories");
    console.log("========\n");

    if (memories.length === 0) {
      console.log("No memories stored.\n");
    } else {
      for (const memory of memories) {
        const date = new Date(memory.createdAt).toLocaleDateString();
        console.log(`[${memory.category}] ${date}`);
        console.log(`  ${memory.content}`);
        console.log(`  (accessed ${memory.accessCount} times)\n`);
      }
    }

    const totalTokens = memoryStore.countTokens();
    console.log(`Total: ${memories.length} memories, ~${totalTokens} tokens\n`);
  } else if (subCommand === "add") {
    const content = args.slice(1).join(" ");
    if (!content) {
      console.error('Error: Memory content required. Usage: tiny-agent memory add "your memory"');
      process.exit(1);
    }
    const memory = memoryStore.add(content);
    console.log(`Memory added: ${memory.id}\n`);
  } else if (subCommand === "clear") {
    const count = memoryStore.count();
    memoryStore.clear();
    console.log(`Cleared ${count} memories.\n`);
  } else if (subCommand === "stats") {
    const memories = memoryStore.list();
    const totalTokens = memoryStore.countTokens();
    console.log("\nMemory Statistics");
    console.log("=================\n");
    console.log(`  Total memories: ${memories.length}`);
    console.log(`  Estimated tokens: ${totalTokens}`);
    console.log(`  By category:`);

    const categories = ["user", "project", "codebase"];
    for (const cat of categories) {
      const count = memories.filter((m) => m.category === cat).length;
      console.log(`    ${cat}: ${count}`);
    }
    console.log();
  } else {
    console.error(`Unknown memory command: ${subCommand}`);
    console.error("Available commands: list, add <content>, clear, stats");
    process.exit(1);
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
      await handleConfig(config, args);
    } else if (command === "status") {
      await handleStatus(config, options);
    } else if (command === "memory") {
      await handleMemory(config, args, options);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: chat, run <prompt>, config, status, memory");
      console.error(
        "Options: --model <model>, --provider <provider>, --verbose, --save, --memory, --help",
      );
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
