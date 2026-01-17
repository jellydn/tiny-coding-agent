import * as readline from "node:readline";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadConfig, getConfigPath } from "../config/loader.js";
import { createProvider } from "../providers/factory.js";
import type { LLMClient } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { fileTools, bashTool, searchTools, webSearchTool, loadPlugins } from "../tools/index.js";
import { Agent, type RuntimeConfig } from "../core/agent.js";
import { McpManager } from "../mcp/manager.js";
import type { ModelCapabilities } from "../providers/capabilities.js";
import { MemoryStore } from "../core/memory.js";
import type { SessionState } from "./chat-commands.js";
import { parseChatCommand } from "./chat-commands.js";
import {
  setConfirmationHandler,
  isSessionApprovedAll,
  isSessionDeniedAll,
  setSessionApproval,
  clearSessionApproval,
  type ConfirmationRequest,
  type ConfirmationResult,
} from "../tools/confirmation.js";
import { setNoColor, shouldUseInk } from "../ui/utils.js";
import { render } from "ink";
import React from "react";
import { Spinner } from "../ui/components/Spinner.js";
import { ToolOutput } from "../ui/components/ToolOutput.js";
// Import provider classes for instanceof checks in handleStatus
import { OpenAIProvider } from "../providers/openai.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OllamaProvider } from "../providers/ollama.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import { OpenCodeProvider } from "../providers/opencode.js";

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
  allowAll?: boolean;
  noColor?: boolean;
}

function formatArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return "";
  const entries = Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const str = typeof v === "string" ? v : JSON.stringify(v);
      if (k === "content" && str.length > 300) {
        return `${k}=\n${str.slice(0, 300)}\n... (${str.length - 300} more chars)`;
      }
      if (str.length > 60) {
        return `${k}=${str.slice(0, 60)}...`;
      }
      return `${k}=${str}`;
    });
  return entries.length > 0 ? ` (${entries.join(", ")})` : "";
}

function displayToolExecutionPlain(te: {
  name: string;
  status: "running" | "complete" | "error";
  args?: Record<string, unknown>;
  output?: string;
  error?: string;
}): void {
  const argsStr = formatArgs(te.args);
  if (te.status === "running") {
    process.stdout.write(`  ${te.name}${argsStr} ...\n`);
  } else if (te.status === "complete") {
    process.stdout.write(`  ${te.name}${argsStr} ✓\n`);
    if (te.output) {
      const lines = te.output.split("\n");
      const preview = lines.length > 6 ? lines.slice(0, 6).join("\n") + "\n  ..." : te.output;
      process.stdout.write(`  │ ${preview.split("\n").join("\n  │ ")}\n`);
    }
  } else if (te.status === "error") {
    process.stdout.write(`  ${te.name}${argsStr} ✗\n`);
    if (te.error) {
      process.stdout.write(`  │ ${te.error.split("\n").join("\n  │ ")}\n`);
    }
  }
}

function displayToolExecutionInk(te: {
  name: string;
  status: "running" | "complete" | "error";
  args?: Record<string, unknown>;
  output?: string;
  error?: string;
}): void {
  if (te.status === "running") {
    return;
  }
  const success = te.status === "complete";
  const outputPreview = te.output ? te.output.split("\n").slice(0, 6).join("\n") : undefined;
  const { unmount } = render(
    <ToolOutput name={te.name} success={success} output={outputPreview} error={te.error} />,
  );
  unmount();
}

function displayToolExecution(
  te: {
    name: string;
    status: "running" | "complete" | "error";
    args?: Record<string, unknown>;
    output?: string;
    error?: string;
  },
  useInk: boolean,
): void {
  if (useInk) {
    displayToolExecutionInk(te);
  } else {
    displayToolExecutionPlain(te);
  }
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
    } else if (arg === "--allow-all" || arg === "-y") {
      options.allowAll = true;
    } else if (arg === "--no-color") {
      options.noColor = true;
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
  const model = options.model || config.defaultModel;
  const provider = options.provider;

  return createProvider({
    model,
    provider: provider as undefined | "openai" | "anthropic" | "ollama" | "openrouter" | "opencode",
    providers: config.providers,
  });
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
  const initialModel = options.model || config.defaultModel;

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

  // Set up confirmation handler for dangerous tools
  if (!options.allowAll) {
    setConfirmationHandler((request: ConfirmationRequest): Promise<ConfirmationResult> => {
      return new Promise((resolve) => {
        const { actions } = request;

        if (isSessionApprovedAll()) {
          resolve(true);
          return;
        }

        if (isSessionDeniedAll()) {
          resolve(false);
          return;
        }

        console.log("\n⚠️  The following operations will be performed:");
        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          if (!action) continue;

          console.log(`  [${i + 1}] ${action.tool}: ${action.description}`);

          const argsPreview = Object.entries(action.args)
            .map(([k, v]) => {
              const str = typeof v === "string" ? v : JSON.stringify(v);
              if (k === "content" && str.length > 200) {
                return `${k}=\n${str.slice(0, 200)}\n... (${str.length - 200} more chars)`;
              }
              if (str.length > 80) {
                return `${k}=${str.slice(0, 80)}...`;
              }
              return `${k}=${str}`;
            })
            .join("\n      ");
          if (argsPreview) console.log(`      ${argsPreview}`);
        }

        rl.question("\nApprove all? (y/N), or enter number to approve individually: ", (answer) => {
          const trimmed = answer.toLowerCase().trim();
          if (trimmed === "y" || trimmed === "yes") {
            setSessionApproval(true);
            resolve(true);
            return;
          }

          if (trimmed === "n" || trimmed === "no") {
            setSessionApproval(false);
            resolve(false);
            return;
          }

          // Check if user entered a number (for per-command approval)
          const num = parseInt(trimmed);
          if (!isNaN(num) && num >= 1 && num <= actions.length) {
            const selectedAction = actions[num - 1];
            if (selectedAction) {
              console.log(`  → Approved [${num}] ${selectedAction.tool}`);
            }
            resolve({ type: "partial", selectedIndex: num - 1 });
            return;
          }

          resolve(false);
        });
      });
    });
  }

  // Handle Ctrl+D (EOF) for graceful exit
  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });

  console.log(`Tiny Coding Agent (model: ${initialModel})`);

  const toolCount = toolRegistry.list().length;
  const memoryStatus = enableMemory ? "enabled" : "disabled";
  const agentsMdStatus = agentsMdPath ? `AGENTS.md loaded` : "no AGENTS.md";
  console.log(`[${toolCount} tools, ${memoryStatus}, ${agentsMdStatus}]`);
  console.log("Use Ctrl+D or /bye to exit");
  console.log("Chat commands: /model <name>, /thinking on|off, /effort low|medium|high");
  console.log('(Fuzzy matching enabled - e.g., "/m" for "/model")\n');

  agent.startChatSession();

  // Session state for runtime model/mode switching
  const sessionState: SessionState = {
    model: initialModel,
    thinking: config.thinking,
  };

  const askQuestion = (): void => {
    rl.question("You: ", async (userInput: string) => {
      clearSessionApproval();

      if (!userInput.trim()) {
        askQuestion();
        return;
      }

      // Check for chat commands
      const { isCommand, newState, matchedCommand, error, shouldExit } =
        parseChatCommand(userInput);

      if (isCommand) {
        const originalCmd = userInput.split(/\s+/)[0];
        const actualCmd = matchedCommand || originalCmd;

        if (shouldExit) {
          console.log(`[Command: ${originalCmd} → ${actualCmd}]`);
          rl.close();
          console.log("Goodbye!");
          process.exit(0);
        }

        if (error) {
          console.log(`[Command Error: ${error}]`);
        } else if (newState) {
          Object.assign(sessionState, newState);
          console.log(`[Command: ${originalCmd} → ${actualCmd}]`);
          console.log(
            `[Mode: model=${sessionState.model}, thinking=${sessionState.thinking?.enabled ?? false}]`,
          );
        }
        askQuestion();
        return;
      }

      try {
        process.stdout.write("\n");
        let hasContent = false;
        const useInk = shouldUseInk();

        // Show spinner while waiting for LLM response
        let spinnerInstance: { unmount: () => void } | null = null;
        if (useInk) {
          spinnerInstance = render(<Spinner isLoading={true} />);
        }

        // Build runtime config from session state
        const runtimeConfig: RuntimeConfig = {
          model: sessionState.model !== initialModel ? sessionState.model : undefined,
          thinking: sessionState.thinking,
        };

        for await (const chunk of agent.runStream(userInput, sessionState.model, runtimeConfig)) {
          // Clear spinner on first content
          if (spinnerInstance && (chunk.content || chunk.toolExecutions)) {
            spinnerInstance.unmount();
            spinnerInstance = null;
          }

          if (chunk.content) {
            process.stdout.write(chunk.content);
            hasContent = true;
          }

          if (chunk.toolExecutions) {
            if (!useInk) {
              process.stdout.write("\n  Tools:\n");
            }
            for (const te of chunk.toolExecutions) {
              displayToolExecution(te, useInk);
            }
            if (!options.noTrackContext && chunk.contextStats) {
              const ctx = chunk.contextStats;
              process.stdout.write(
                `  Context: ${ctx.totalTokens}/${ctx.maxContextTokens} tokens\n`,
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
        const useInk = shouldUseInk();
        if (!useInk) {
          process.stdout.write("\n  Tools:\n");
        }
        for (const te of chunk.toolExecutions) {
          displayToolExecution(te, useInk);
        }
        if (!options.noTrackContext && chunk.contextStats) {
          const ctx = chunk.contextStats;
          process.stdout.write(`  Context: ${ctx.totalTokens}/${ctx.maxContextTokens} tokens\n`);
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
    supported ? "  ✓" : "  ✗";

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
    --no-color                         Disable colored output (for pipes/non-TTY)
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

For more information, visit: https://github.com/jellydn/tiny-coding-agent
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

    if (options.noColor) {
      setNoColor(true);
    }

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
