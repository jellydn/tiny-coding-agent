import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadConfig, getConfigPath } from "../config/loader.js";
import { createProvider } from "../providers/factory.js";
import type { LLMClient } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import {
  fileTools,
  bashTool,
  searchTools,
  webSearchTool,
  loadPlugins,
  createSkillTool,
} from "../tools/index.js";
import { Agent } from "../core/agent.js";
import { McpManager } from "../mcp/manager.js";
import type { ModelCapabilities } from "../providers/capabilities.js";
import { MemoryStore } from "../core/memory.js";
import { setNoColor, setJsonMode, shouldUseInk, isJsonMode } from "../ui/utils.js";
import { statusLineManager } from "../ui/index.js";
import { StatusType } from "../ui/types/enums.js";
import { render } from "ink";
import { ToolOutput } from "../ui/components/ToolOutput.js";
import { OpenAIProvider } from "../providers/openai.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OllamaProvider } from "../providers/ollama.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import { OpenCodeProvider } from "../providers/opencode.js";

/**
 * Configuration for tool output preview in plain text mode.
 * Can be overridden via TINY_AGENT_TOOL_PREVIEW_LINES environment variable.
 */
const TOOL_PREVIEW_LINES = Number.parseInt(process.env.TINY_AGENT_TOOL_PREVIEW_LINES ?? "6", 10);

interface CliOptions {
  model?: string;
  provider?: string;
  verbose?: boolean;
  save?: boolean;
  help?: boolean;
  noMemory?: boolean;
  noTrackContext?: boolean;
  noStatus?: boolean;
  memoryFile?: string;
  agentsMd?: string;
  allowAll?: boolean;
  noColor?: boolean;
  json?: boolean;
}

class ThinkingTagFilter {
  private buffer = "";
  private inThinkingBlock = false;

  filter(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    while (this.buffer.length > 0) {
      if (this.inThinkingBlock) {
        const endIdx = this.buffer.indexOf("</think>");
        if (endIdx !== -1) {
          this.buffer = this.buffer.slice(endIdx + 8);
          this.inThinkingBlock = false;
        } else {
          if (this.buffer.length > 100) {
            this.buffer = this.buffer.slice(-20);
          }
          break;
        }
      } else {
        const startIdx = this.buffer.indexOf("<think>");
        if (startIdx !== -1) {
          output += this.buffer.slice(0, startIdx);
          this.buffer = this.buffer.slice(startIdx + 7);
          this.inThinkingBlock = true;
        } else {
          const partialMatch = this.findPartialTag(this.buffer, "<think>");
          if (partialMatch > 0) {
            output += this.buffer.slice(0, this.buffer.length - partialMatch);
            this.buffer = this.buffer.slice(-partialMatch);
            break;
          } else {
            output += this.buffer;
            this.buffer = "";
          }
        }
      }
    }

    return output;
  }

  private findPartialTag(text: string, tag: string): number {
    for (let i = 1; i < tag.length; i++) {
      if (text.endsWith(tag.slice(0, i))) {
        return i;
      }
    }
    return 0;
  }

  flush(): string {
    const remaining = this.inThinkingBlock ? "" : this.buffer;
    this.buffer = "";
    this.inThinkingBlock = false;
    return remaining;
  }
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
      const preview =
        lines.length > TOOL_PREVIEW_LINES
          ? lines.slice(0, TOOL_PREVIEW_LINES).join("\n") + "\n  ..."
          : te.output;
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
  const { unmount } = render(
    <ToolOutput
      name={te.name}
      success={success}
      output={te.output}
      error={te.error}
      args={te.args}
    />,
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

interface JsonOutput {
  type: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

function outputJson(data: JsonOutput): void {
  console.log(JSON.stringify(data));
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
    } else if (arg === "--no-status") {
      options.noStatus = true;
    } else if (arg === "--agents-md" && i + 1 < args.length) {
      options.agentsMd = args[i + 1];
      i++;
    } else if (arg === "--allow-all" || arg === "-y") {
      options.allowAll = true;
    } else if (arg === "--no-color") {
      options.noColor = true;
    } else if (arg === "--json") {
      options.json = true;
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

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.on("error", () => {
      resolve("");
    });
  });
}

async function handleRun(
  config: ReturnType<typeof loadConfig>,
  args: string[],
  options: CliOptions,
): Promise<void> {
  const promptArg = args.join(" ");
  const stdinContent = await readStdin();

  let prompt = promptArg;
  if (stdinContent.trim()) {
    prompt = stdinContent.trim() + (promptArg ? `\n\n${promptArg}` : "");
  }

  if (!prompt) {
    console.error("Error: run command requires a prompt (or pipe content to stdin)");
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
    providerConfigs: config.providers,
    skillDirectories: config.skillDirectories,
  });

  const skillTool = createSkillTool(agent.getSkillRegistry());
  toolRegistry.register(skillTool);

  const toolCount = toolRegistry.list().length;
  const memoryStatus = enableMemory ? "memory enabled" : "no memory";
  const agentsMdStatus = agentsMdPath ? "AGENTS.md loaded" : "";
  const jsonMode = isJsonMode();
  const useInk = shouldUseInk();

  if (!jsonMode) {
    console.log(
      `[${toolCount} tools, ${memoryStatus}${agentsMdStatus ? `, ${agentsMdStatus}` : ""}]`,
    );
  }

  if (jsonMode) {
    outputJson({ type: "user", content: prompt });
  }

  const runPrompt = async (currentPrompt: string): Promise<void> => {
    let accumulatedContent = "";
    const thinkFilter = new ThinkingTagFilter();

    statusLineManager.setModel(model);
    statusLineManager.setStatus(StatusType.THINKING);

    for await (const chunk of agent.runStream(currentPrompt, model)) {
      if (chunk.content) {
        const filtered = thinkFilter.filter(chunk.content);
        if (jsonMode) {
          accumulatedContent += filtered;
        } else if (filtered) {
          process.stdout.write(filtered);
        }
      }

      if (chunk.toolExecutions) {
        const runningTool = chunk.toolExecutions.find((te) => te.status === "running");
        if (runningTool) {
          statusLineManager.setTool(runningTool.name);
        } else {
          statusLineManager.clearTool();
        }

        if (jsonMode) {
          for (const te of chunk.toolExecutions) {
            if (te.status !== "running") {
              outputJson({
                type: "tool",
                content: te.status === "complete" ? (te.output ?? "") : (te.error ?? ""),
                toolName: te.name,
              });
            }
          }
        } else {
          if (!useInk) {
            process.stdout.write("\n  Tools:\n");
          }
          for (const te of chunk.toolExecutions) {
            displayToolExecution(te, useInk);
          }
          if (!options.noTrackContext && chunk.contextStats) {
            const ctx = chunk.contextStats;
            statusLineManager.setContext(ctx.totalTokens, ctx.maxContextTokens);
          }
        }
      }

      if (chunk.done) {
        statusLineManager.setStatus(StatusType.READY);

        if (chunk.maxIterationsReached) {
          if (!jsonMode) {
            console.log(`\n[Max iterations reached, continuing...]`);
          }
          await runPrompt("continue");
          return;
        }
      }
    }

    const remaining = thinkFilter.flush();
    accumulatedContent += remaining;
    if (remaining && !jsonMode) {
      process.stdout.write(remaining);
    }

    if (jsonMode && accumulatedContent) {
      outputJson({ type: "assistant", content: accumulatedContent });
    } else if (!jsonMode) {
      process.stdout.write("\n");
    }
  };

  try {
    await runPrompt(prompt);
    process.exit(0);
  } catch (err) {
    statusLineManager.setStatus(StatusType.ERROR);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${message}`);
    statusLineManager.setStatus(StatusType.READY);
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

async function handleInteractiveChat(
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
    providerConfigs: config.providers,
    skillDirectories: config.skillDirectories,
  });

  const skillTool = createSkillTool(agent.getSkillRegistry());
  toolRegistry.register(skillTool);

  const { App: InkApp, renderApp } = await import("../ui/index.js");

  const enabledProviders = {
    openai: !!config.providers.openai,
    anthropic: !!config.providers.anthropic,
    ollama: !!config.providers.ollama,
    ollamaCloud: !!config.providers.ollamaCloud,
    openrouter: !!config.providers.openrouter,
    opencode: !!config.providers.opencode,
  };

  const { waitUntilExit } = renderApp(
    <InkApp initialModel={initialModel} agent={agent} enabledProviders={enabledProviders} />,
  );

  await waitUntilExit();
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
    tiny-agent skill [command]         Manage skills

COMMANDS:
    memory list                        List all stored memories
    memory add <content>               Add a new memory
    memory clear                       Clear all memories
    memory stats                       Show memory statistics
    skill list                         List all discovered skills
    skill show <name>                  Show full skill content
    skill init <name>                  Initialize a new skill

OPTIONS:
    --model <model>                    Override default model
    --provider <provider>              Override provider (openai|anthropic|ollama)
    --verbose, -v                      Enable verbose logging
    --save                             Save conversation to file
    --no-memory                        Disable memory (enabled by default)
    --no-track-context                 Disable context tracking (enabled by default)
    --no-status                        Disable status line
    --agents-md <path>                 Path to AGENTS.md file (auto-detected in cwd)
    --no-color                         Disable colored output (for pipes/non-TTY)
    --json                             Output messages as JSON (for programmatic use)
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

async function handleSkill(
  config: ReturnType<typeof loadConfig>,
  args: string[],
  _options: CliOptions,
): Promise<void> {
  const subCommand = args[0] || "list";

  if (subCommand === "list") {
    const skillDirectories = config.skillDirectories || [];
    const { discoverSkills } = await import("../skills/loader.js");
    const skills = await discoverSkills(skillDirectories);

    if (_options.json) {
      console.log(
        JSON.stringify(
          skills.map((s) => ({
            name: s.name,
            description: s.description,
            location: s.location,
          })),
        ),
      );
    } else {
      console.log("\nSkills");
      console.log("======\n");

      if (skills.length === 0) {
        console.log("No skills found.");
        if (skillDirectories.length > 0) {
          console.log(`  Configured directories: ${skillDirectories.join(", ")}`);
        } else {
          console.log("  No skill directories configured.");
        }
        console.log("\n  To add skills, configure skillDirectories in config.yaml");
        console.log("  or run: tiny-agent skill init <name>\n");
      } else {
        for (const skill of skills) {
          const truncatedDesc =
            skill.description.length > 60
              ? `${skill.description.slice(0, 60)}...`
              : skill.description;
          console.log(`  ${skill.name}`);
          console.log(`    ${truncatedDesc}`);
          console.log();
        }
        console.log(`Total: ${skills.length} skill(s)\n`);
      }
    }
  } else if (subCommand === "show") {
    const skillName = args[1];
    if (!skillName) {
      console.error("Error: Skill name required. Usage: tiny-agent skill show <name>");
      process.exit(1);
    }

    const skillDirectories = config.skillDirectories || [];
    const { discoverSkills } = await import("../skills/loader.js");
    const { readFileSync } = await import("node:fs");
    const skills = await discoverSkills(skillDirectories);
    const skill = skills.find((s) => s.name === skillName);

    if (!skill) {
      console.error(`Error: Skill not found: ${skillName}`);
      const available = skills.map((s) => s.name).join(", ");
      if (available) {
        console.error(`  Available skills: ${available}`);
      }
      process.exit(1);
    }

    try {
      const content = readFileSync(skill.location, "utf-8");

      if (_options.json) {
        console.log(
          JSON.stringify({
            name: skill.name,
            description: skill.description,
            body: content,
          }),
        );
      } else {
        console.log(`\nSkill: ${skill.name}`);
        console.log(`======\n`);
        console.log(`Description: ${skill.description}`);
        console.log(`Location: ${skill.location}`);
        console.log("\n---\n");
        console.log(content);
        console.log();
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        console.error(`Error: Skill file not found: ${skill.location}`);
      } else {
        console.error(`Error reading skill: ${error.message}`);
      }
      process.exit(1);
    }
  } else if (subCommand === "init") {
    const skillName = args[1];
    if (!skillName) {
      console.error("Error: Skill name required. Usage: tiny-agent skill init <name>");
      process.exit(1);
    }

    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(skillName) || skillName.includes("--")) {
      console.error(
        "Error: Invalid skill name. Must be lowercase alphanumeric with hyphens, no leading/trailing hyphens or consecutive hyphens.",
      );
      process.exit(1);
    }

    const { homedir } = await import("node:os");
    const { mkdirSync, existsSync, writeFileSync } = await import("node:fs");
    const skillDir = `${homedir()}/.tiny-agent/skills/${skillName}`;
    const skillFile = `${skillDir}/SKILL.md`;

    if (existsSync(skillDir)) {
      console.error(`Error: Skill directory already exists: ${skillDir}`);
      process.exit(1);
    }

    try {
      mkdirSync(skillDir, { recursive: true });

      const template = `---
name: ${skillName}
description: A short description of what this skill does

# Skill Instructions

## When to Use
Describe when this skill should be activated...

## Steps
1. First step...
2. Second step...
3. Third step...

## Examples
\`\`\`example
User input example
\`\`\`

## Notes
- Important considerations...
- Common pitfalls to avoid...
`;

      writeFileSync(skillFile, template, "utf-8");
      console.log(`Skill created: ${skillFile}`);
      console.log("\nTo use this skill, add the skill directory to your config.yaml:");
      console.log("  skillDirectories:");
      console.log(`    - ${homedir()}/.tiny-agent/skills`);
      console.log("\nOr run: tiny-agent skill list to verify the skill is discovered.\n");
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      console.error(`Error creating skill: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown skill command: ${subCommand}`);
    console.error("Available commands: list, show, init");
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

    if (options.json) {
      setJsonMode(true);
    }

    if (options.noStatus) {
      statusLineManager.setShowStatusLine(false);
    }

    if (options.help) {
      showHelp();
      process.exit(0);
    }

    const config = loadConfig();

    if (command === "chat") {
      await handleInteractiveChat(config, options);
    } else if (command === "run") {
      await handleRun(config, args, options);
    } else if (command === "config") {
      await handleConfig(config, args);
    } else if (command === "status") {
      await handleStatus(config, options);
    } else if (command === "memory") {
      await handleMemory(config, args, options);
    } else if (command === "skill") {
      await handleSkill(config, args, options);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: chat, run <prompt>, config, status, memory, skill");
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
