import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadConfig, getConfigPath } from "../config/loader.js";
import { isCommandAvailable } from "../utils/command.js";
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
import {
  McpManager,
  getGlobalMcpManager,
  setGlobalMcpManager,
  globToRegex,
} from "../mcp/manager.js";
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
import { getBuiltinSkillsDir } from "../skills/loader.js";

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
  skillsDir?: string[];
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
          output += this.buffer;
          this.buffer = "";
        }
      }
    }

    return output;
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

type ToolExecutionDisplay = {
  name: string;
  status: "running" | "complete" | "error";
  args?: Record<string, unknown>;
  output?: string;
  error?: string;
};

function displayToolExecutionPlain(te: ToolExecutionDisplay): void {
  const argsStr = formatArgs(te.args);
  if (te.status === "running") {
    process.stdout.write(`  ${te.name}${argsStr} ...\n`);
  } else if (te.status === "complete") {
    process.stdout.write(`  ${te.name}${argsStr} ✓\n`);
    if (te.output) {
      const lines = te.output.split("\n");
      const preview =
        lines.length > TOOL_PREVIEW_LINES
          ? `${lines.slice(0, TOOL_PREVIEW_LINES).join("\n")}\n  ...`
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

function displayToolExecutionInk(te: ToolExecutionDisplay): void {
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

function displayToolExecution(te: ToolExecutionDisplay, useInk: boolean): void {
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
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--model":
        options.model = args[++i];
        break;
      case "--provider":
        options.provider = args[++i];
        break;
      case "-v":
      case "--verbose":
        options.verbose = true;
        break;
      case "--save":
        options.save = true;
        break;
      case "--no-memory":
        options.noMemory = true;
        break;
      case "--no-track-context":
        options.noTrackContext = true;
        break;
      case "--no-status":
        options.noStatus = true;
        break;
      case "--agents-md":
        options.agentsMd = args[++i];
        break;
      case "--allow-all":
      case "-y":
        options.allowAll = true;
        break;
      case "--no-color":
        options.noColor = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--skills-dir": {
        const dirValue = args[++i];
        if (dirValue) {
          if (!options.skillsDir) {
            options.skillsDir = [];
          }
          options.skillsDir.push(dirValue);
        }
        break;
      }
      default:
        if (arg && !arg.startsWith("-")) {
          positionalArgs.push(arg);
        }
    }
  }

  return {
    command: positionalArgs[0] || "chat",
    args: positionalArgs.slice(1),
    options,
  };
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

  // Check if tool name matches any disabled pattern
  const isDisabledByPattern = (name: string): boolean => {
    if (!config.disabledMcpPatterns || config.disabledMcpPatterns.length === 0) {
      return false;
    }
    // Only check patterns for MCP tools
    if (!name.startsWith("mcp_")) {
      return false;
    }
    return config.disabledMcpPatterns.some((pattern) => globToRegex(pattern).test(name));
  };

  const isToolEnabled = (name: string): boolean => {
    // Check if disabled by pattern first (for MCP tools)
    if (isDisabledByPattern(name)) {
      return false;
    }
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
    const mcpManager = new McpManager({ disabledPatterns: config.disabledMcpPatterns ?? [] });
    setGlobalMcpManager(mcpManager);

    const serverEntries = Object.entries(config.mcpServers);
    for (const [serverName, serverConfig] of serverEntries) {
      await mcpManager.addServer(serverName, serverConfig);
    }
    const connectedCount = serverEntries.length;
    statusLineManager.setMcpServerCount(connectedCount);
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
    // Update status line with MCP server count (count servers with tools = connected)
    const serverStatus = mcpManager.getServerStatus();
    const connectedServers = serverStatus.filter((s) => s.connected && s.toolCount > 0).length;
    statusLineManager.setMcpServerCount(connectedServers);
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

  const skillDirectories = options.skillsDir
    ? [...(config.skillDirectories || []), ...options.skillsDir]
    : config.skillDirectories;

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
    skillDirectories,
  });

  const skillTool = createSkillTool(agent.getSkillRegistry(), (allowedTools) => {
    agent._setSkillRestriction(allowedTools);
  });
  toolRegistry.register(skillTool);

  // Wait for skills to be initialized before getting the count
  await agent.waitForSkills();

  const toolCount = toolRegistry.list().length;
  const skillCount = agent.getSkillRegistry().size;
  const memoryStatus = enableMemory ? "memory enabled" : "no memory";
  const agentsMdStatus = agentsMdPath ? "AGENTS.md loaded" : "";
  const jsonMode = isJsonMode();
  const useInk = shouldUseInk();

  if (!jsonMode && options.verbose) {
    const statusItems = [
      `${toolCount} tools`,
      skillCount > 0 && `${skillCount} skill${skillCount === 1 ? "" : "s"}`,
      memoryStatus,
      agentsMdStatus,
    ].filter(Boolean);

    console.log(`[${statusItems.join(", ")}]`);
  }

  if (jsonMode) {
    outputJson({ type: "user", content: prompt });
  }

  // Initialize status line with model and context info
  statusLineManager.setModel(model);
  const contextMax = maxContextTokens ?? 32000;
  statusLineManager.setContext(0, contextMax);

  const runPrompt = async (currentPrompt: string): Promise<void> => {
    let accumulatedContent = "";
    const thinkFilter = new ThinkingTagFilter();

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
        }
        // Don't clear tool on complete - keep it visible until next tool starts

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
        }
      }

      // Update context on every chunk (not just when tools execute)
      if (!options.noTrackContext && chunk.contextStats) {
        const ctx = chunk.contextStats;
        const maxTokens = ctx.maxContextTokens ?? 32000;
        statusLineManager.setContext(ctx.totalTokens, maxTokens);
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
    statusLineManager.clearTool();
    statusLineManager.setStatus(StatusType.READY);
    process.exit(0);
  } catch (err) {
    statusLineManager.setStatus(StatusType.ERROR);
    statusLineManager.clearTool();
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
    const mcpManager = getGlobalMcpManager();
    if (mcpManager) {
      const serverStatus = mcpManager.getServerStatus();
      for (const server of serverStatus) {
        const status = server.connected ? "●" : "○";
        const tools = server.toolCount > 0 ? ` (${server.toolCount} tools)` : "";
        console.log(`  ${status} ${server.name}${tools}`);
      }
    } else {
      for (const [name] of Object.entries(config.mcpServers)) {
        console.log(`  - ${name}`);
      }
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
  const initialModel = options.model || config.defaultModel;

  const enableMemory = !options.noMemory || config.memoryFile !== undefined;
  const maxContextTokens = config.maxContextTokens ?? (enableMemory ? 32000 : undefined);

  const agentsMdPath =
    options.agentsMd ??
    (existsSync(join(process.cwd(), "AGENTS.md")) ? join(process.cwd(), "AGENTS.md") : undefined);

  const skillDirectories = options.skillsDir
    ? [...(config.skillDirectories || []), ...options.skillsDir]
    : config.skillDirectories;

  // Initialize status line with model immediately
  statusLineManager.setModel(initialModel.replace(/^opencode\//, ""));
  const contextMax = maxContextTokens ?? 32000;
  statusLineManager.setContext(0, contextMax);

  const { App: InkApp, renderApp } = await import("../ui/index.js");

  const enabledProviders = {
    openai: !!config.providers.openai,
    anthropic: !!config.providers.anthropic,
    ollama: !!config.providers.ollama,
    ollamaCloud: !!config.providers.ollamaCloud,
    openrouter: !!config.providers.openrouter,
    opencode: !!config.providers.opencode,
  };

  // Render UI immediately with agent=undefined (will show LoadingScreen)
  const { rerender, waitUntilExit } = renderApp(
    <InkApp initialModel={initialModel} agent={undefined} enabledProviders={enabledProviders} />,
  );

  // Do full initialization in background
  const initBackground = async () => {
    try {
      const llmClient = await createLLMClient(config, options);
      const toolRegistry = await setupTools(config);

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
        skillDirectories,
      });

      const skillTool = createSkillTool(agent.getSkillRegistry(), (allowedTools) => {
        agent._setSkillRestriction(allowedTools);
      });
      toolRegistry.register(skillTool);

      // Wait for skills to be initialized
      await agent.waitForSkills();

      // Re-render with the fully initialized agent
      rerender(
        <InkApp initialModel={initialModel} agent={agent} enabledProviders={enabledProviders} />,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Background initialization error: ${message}`);
    }
  };

  initBackground();

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
    --skills-dir <path>                Add a skill directory (can be used multiple times)
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
  console.log(`    OllamaCloud: ${config.providers.ollamaCloud ? "configured" : "not configured"}`);
  console.log(`    OpenCode: ${config.providers.opencode ? "configured" : "not configured"}`);

  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    console.log("\n  MCP Servers:");
    for (const [name] of Object.entries(config.mcpServers)) {
      console.log(`    - ${name}`);
    }
  }
  process.exit(0);
}

async function handleMcp(args: string[]): Promise<void> {
  const subCommand = args[0] || "list";
  const configPath = getConfigPath();

  // Default MCP servers
  const defaultServers: Record<string, { command: string; args: string[] }> = {
    context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    serena: {
      command: "uvx",
      args: [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena-mcp-server",
        "--context",
        "ide",
        "--project",
        ".",
        "--open-web-dashboard",
        "false",
      ],
    },
  };

  // Helper to read/write config
  const readConfig = async (): Promise<Record<string, unknown>> => {
    if (!existsSync(configPath)) return {};
    const content = await readFile(configPath, "utf-8");
    const { parse: parseYaml } = await import("yaml");
    return (parseYaml(content) as Record<string, unknown>) || {};
  };

  const writeConfig = async (config: Record<string, unknown>): Promise<void> => {
    const { stringify: stringifyYaml } = await import("yaml");
    await writeFile(configPath, stringifyYaml(config), "utf-8");
  };

  // Read config once for all operations
  const fileConfig = await readConfig();
  const userServers = ((fileConfig.mcpServers || {}) as Record<string, unknown>) || {};
  const enabledServers = Object.keys(userServers);

  if (subCommand === "list") {
    console.log("MCP Servers");
    console.log("===========\n");

    const hasUserMcpConfig = enabledServers.length > 0;

    if (!hasUserMcpConfig) {
      console.log("No mcpServers configured. Using defaults:");
      console.log("(Set 'mcpServers: {}' in config to disable all)\n");
    }

    // Default servers
    console.log("Available MCP Servers:");
    for (const [name, serverConfig] of Object.entries(defaultServers)) {
      const isEnabled = enabledServers.includes(name);
      const status = isEnabled ? "● enabled" : "○ disabled";
      const argsStr = serverConfig.args.join(" ");
      console.log(`  ${status} ${name}`);
      console.log(`    Command: ${serverConfig.command} ${argsStr}`);

      if (!isCommandAvailable(serverConfig.command)) {
        console.log(
          `    ⚠ Command "${serverConfig.command}" not found. Install required dependency.`,
        );
      }
    }

    // User-added servers (not in defaults)
    const userAdded = Object.entries(userServers).filter(([name]) => !defaultServers[name]);
    if (userAdded.length > 0) {
      console.log("\nCustom Servers:");
      for (const [name, serverConfig] of userAdded) {
        const cfg = serverConfig as { command: string; args?: string[] };
        const argsStr = (cfg.args || []).join(" ");
        console.log(`  ● ${name}`);
        console.log(`    Command: ${cfg.command} ${argsStr}`);
        if (!isCommandAvailable(cfg.command)) {
          console.log(`    ⚠ Command "${cfg.command}" not found.`);
        }
      }
    }

    console.log("\nUse './tiny-agent mcp add <name> <command> [args...]' to add a server");
    console.log("Use './tiny-agent mcp enable <name>' to enable a default server");
    console.log("Use './tiny-agent mcp disable <name>' to disable a server");
    process.exit(0);
  }

  if (subCommand === "add") {
    const name = args[1];
    const command = args[2];

    if (!name || !command) {
      console.log("Usage: ./tiny-agent mcp add <name> <command> [args...]");
      console.log("Example: ./tiny-agent mcp add myserver npx -y @org/mcp-server");
      process.exit(1);
    }

    const serverArgs = args.slice(3);

    if (!isCommandAvailable(command)) {
      console.log(`⚠ Warning: Command "${command}" not found.`);
      console.log(
        `   The server "${name}" will not work until you install the required dependency.`,
      );
      console.log();
    }

    if (!fileConfig.mcpServers) fileConfig.mcpServers = {};
    (fileConfig.mcpServers as Record<string, unknown>)[name] = { command, args: serverArgs };
    await writeConfig(fileConfig);
    console.log(`Added MCP server: ${name}`);
    console.log(`  Command: ${command} ${serverArgs.join(" ")}`);
    process.exit(0);
  }

  if (subCommand === "enable") {
    const name = args[1];

    if (!name) {
      console.log("Usage: ./tiny-agent mcp enable <name>");
      console.log("Example: ./tiny-agent mcp enable serena");
      process.exit(1);
    }

    if (!defaultServers[name]) {
      console.log(`Unknown MCP server: ${name}`);
      console.log("Available: context7, serena");
      process.exit(1);
    }

    const serverConfig = defaultServers[name];

    if (!isCommandAvailable(serverConfig.command)) {
      console.log(`⚠ Warning: Command "${serverConfig.command}" not found.`);
      console.log(
        `   The server "${name}" will not work until you install the required dependency.`,
      );
      console.log(`   For serena, install uv: curl -LsSf https://astral.sh/uv/install.sh | sh`);
      console.log();
    }

    if (!fileConfig.mcpServers) fileConfig.mcpServers = {};
    (fileConfig.mcpServers as Record<string, unknown>)[name] = serverConfig;
    await writeConfig(fileConfig);
    console.log(`Enabled MCP server: ${name}`);
    process.exit(0);
  }

  if (subCommand === "disable") {
    const name = args[1];

    if (!name) {
      console.log("Usage: ./tiny-agent mcp disable <name>");
      process.exit(1);
    }

    if (!userServers[name]) {
      console.log(`MCP server "${name}" is not configured`);
      process.exit(1);
    }

    delete userServers[name];
    fileConfig.mcpServers = userServers;
    await writeConfig(fileConfig);
    console.log(`Disabled MCP server: ${name}`);
    process.exit(0);
  }

  console.log(`Unknown subcommand: ${subCommand}`);
  console.log("Usage: ./tiny-agent mcp [list|add|enable|disable]");
  process.exit(1);
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

  // Wait for async loading to complete before listing
  await memoryStore.init();
  memoryStore.touchAll();
  await memoryStore.flush();

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
    const builtinDir = getBuiltinSkillsDir();
    const skills = await discoverSkills(skillDirectories, builtinDir);

    if (_options.json) {
      console.log(
        JSON.stringify(
          skills.map((s) => ({
            name: s.name,
            description: s.description,
            location: s.location,
            isBuiltin: s.isBuiltin,
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
          const builtinIndicator = skill.isBuiltin ? " [builtin]" : "";
          console.log(`  ${skill.name}${builtinIndicator}`);
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
    const builtinDir = getBuiltinSkillsDir();
    const skills = await discoverSkills(skillDirectories, builtinDir);
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
      let content: string;
      if (skill.location.startsWith("builtin://")) {
        const { getEmbeddedSkillContent } = await import("../skills/builtin-registry.js");
        const builtinContent = getEmbeddedSkillContent(skill.name);
        if (!builtinContent) {
          console.error(`Error: Built-in skill content not found: ${skill.name}`);
          process.exit(1);
        }
        content = builtinContent;
      } else {
        const { readFile } = await import("node:fs/promises");
        content = await readFile(skill.location, "utf-8");
      }

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

    // Validate skill name using the same pattern as parser.ts
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) {
      console.error(
        "Error: Invalid skill name. Must be lowercase alphanumeric with hyphens, no leading/trailing hyphens or consecutive hyphens.",
      );
      process.exit(1);
    }

    const { homedir } = await import("node:os");
    const { mkdir, writeFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const skillDir = join(homedir(), ".tiny-agent", "skills", skillName);
    const skillFile = join(skillDir, "SKILL.md");

    // Check if directory exists by trying to list it
    try {
      await readdir(skillDir);
      console.error(`Error: Skill directory already exists: ${skillDir}`);
      process.exit(1);
    } catch {
      // Directory doesn't exist, which is what we want
    }

    try {
      await mkdir(skillDir, { recursive: true });

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

      await writeFile(skillFile, template, "utf-8");
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
    } else if (command === "mcp") {
      await handleMcp(args);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: chat, run <prompt>, config, status, memory, skill, mcp");
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
