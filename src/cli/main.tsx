import { render } from "ink";
import { loadConfig } from "../config/loader.js";
import { getEnabledProviders, getProviderDisplayName } from "../ui/components/ModelPicker.js";
import { ToolOutput } from "../ui/components/ToolOutput.js";
import { statusLineManager } from "../ui/index.js";
import { StatusType } from "../ui/types/enums.js";
import { isJsonMode, setJsonMode, setNoColor, shouldUseInk } from "../ui/utils.js";
import { dispatchCommand, dispatchPreConfig, registerMainHandlers } from "./command-dispatch.js";
import { handleUpgrade } from "./handlers/upgrade.js";
import { type CliOptions, createAgent, parseArgs } from "./shared.js";

const TOOL_PREVIEW_LINES = Number.parseInt(process.env.TINY_AGENT_TOOL_PREVIEW_LINES ?? "6", 10);

export class ThinkingTagFilter {
	private buffer = "";
	private pendingContent = "";

	filter(chunk: string): string {
		if (this.pendingContent.length > 0) {
			chunk = this.pendingContent + chunk;
			this.pendingContent = "";
		}
		this.buffer += chunk;
		let result = "";
		let lastIndex = 0;

		while (true) {
			const startIdx = this.buffer.indexOf("<thinking>", lastIndex);
			if (startIdx === -1) {
				break;
			}

			const endIdx = this.buffer.indexOf("</thinking>", startIdx + 11);
			if (endIdx === -1) {
				const contentBefore = this.buffer.slice(lastIndex, startIdx);
				if (contentBefore.length > 0) {
					result += `${contentBefore}\n`;
				}
				this.pendingContent = this.buffer.slice(startIdx);
				this.buffer = "";
				return result;
			}

			const contentBefore = this.buffer.slice(lastIndex, startIdx);
			result += contentBefore;
			const afterEnd = this.buffer.slice(endIdx + 11);
			if (contentBefore.length > 0 && afterEnd.length > 0 && !afterEnd.startsWith("<thinking>")) {
				result += "\n";
			}
			lastIndex = endIdx + 11;
		}

		result += this.buffer.slice(lastIndex);
		this.buffer = "";
		return result;
	}

	flush(): string {
		const remaining = this.buffer;
		this.buffer = "";
		this.pendingContent = "";
		return remaining;
	}
}

export function formatArgs(args: Record<string, unknown> | undefined): string {
	if (!args || Object.keys(args).length === 0) return "";
	const entries = Object.entries(args)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => {
			const str = typeof v === "string" ? v : JSON.stringify(v);
			if (str.length >= 80) {
				if (k === "content") {
					return `${k}=\n${str.slice(0, 80)}\n... (${str.length - 80} more chars)`;
				}
				return `${k}=${str.slice(0, 80)}...`;
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

function formatOutputPreview(output: string): string {
	const lines = output.split("\n");
	const preview =
		lines.length > TOOL_PREVIEW_LINES ? `${lines.slice(0, TOOL_PREVIEW_LINES).join("\n")}\n  ...` : output;
	return `  │ ${preview.split("\n").join("\n  │ ")}\n`;
}

function toolExecutionHeader(te: ToolExecutionDisplay, symbol: string): string {
	const argsStr = formatArgs(te.args);
	return `  [${symbol}] ${te.name}${argsStr}\n`;
}

function displayToolExecutionPlain(te: ToolExecutionDisplay): void {
	const isRunning = te.status === "running";
	const isComplete = te.status === "complete";
	const isError = te.status === "error";

	if (isRunning) {
		process.stdout.write(toolExecutionHeader(te, ""));
		return;
	}

	const symbol = isComplete ? "✓" : isError ? "✗" : "";
	process.stdout.write(toolExecutionHeader(te, symbol));

	const outputToShow = isComplete ? te.output : isError ? te.error : undefined;
	if (outputToShow) {
		process.stdout.write(formatOutputPreview(outputToShow));
	}
}

function displayToolExecutionInk(te: ToolExecutionDisplay): void {
	if (te.status === "running") {
		return;
	}
	const success = te.status === "complete";
	const { unmount } = render(
		<ToolOutput name={te.name} success={success} output={te.output} error={te.error} args={te.args} />
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

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";

	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => (data += chunk));
		process.stdin.on("end", () => resolve(data));
	});
}

async function handleRun(config: ReturnType<typeof loadConfig>, args: string[], options: CliOptions): Promise<void> {
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

	const jsonMode = isJsonMode();
	const useInk = shouldUseInk();

	// Display initialization progress
	if (!jsonMode && !useInk) {
		console.log("Initializing...");
	}

	const { agent, mcpManager, toolRegistry, agentsMdPath } = await createAgent(config, options);

	const model = options.model || config.defaultModel;

	// Derive display-only values (the actual config is already in the agent)
	const enableMemory = !options.noMemory || config.memoryFile !== undefined;
	const maxContextTokens = config.maxContextTokens ?? (enableMemory ? 32000 : undefined);

	if (!jsonMode && !useInk) {
		const providerName = getProviderDisplayName(config.providers);
		console.log(`  Provider: ${providerName}`);
		const toolCount = toolRegistry.list().length;
		console.log(`  Tools: ${toolCount} loaded`);

		if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
			if (mcpManager) {
				const serverStatus = mcpManager.getServerStatus();
				for (const server of serverStatus) {
					const status = server.connected ? "●" : "○";
					console.log(`  MCP: ${status} ${server.name} (${server.toolCount} tools)`);
				}
			}
		}
	}

	const skillCount = agent.getSkillRegistry().size;

	if (!jsonMode && !useInk) {
		if (skillCount > 0) {
			console.log(`  Skills: ${skillCount} discovered`);
		}
		console.log(`  Memory: ${enableMemory ? "enabled" : "disabled"}`);
		if (agentsMdPath) {
			console.log(`  AGENTS.md: loaded`);
		}
		console.log(`  Model: ${model}`);
		console.log(); // Empty line before starting
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

async function handleInteractiveChat(
	config: ReturnType<typeof loadConfig>,
	args: string[],
	options: CliOptions
): Promise<void> {
	const initialModel = options.model || config.defaultModel;
	const initialPrompt = args.join(" ").trim() || undefined;

	const enableMemory = !options.noMemory || config.memoryFile !== undefined;
	const maxContextTokens = config.maxContextTokens ?? (enableMemory ? 32000 : undefined);

	// Initialize status line with model immediately
	statusLineManager.setModel(initialModel.replace(/^opencode\//, ""));
	const contextMax = maxContextTokens ?? 32000;
	statusLineManager.setContext(0, contextMax);

	const { App: InkApp, renderApp } = await import("../ui/index.js");

	const enabledProviders = getEnabledProviders(config.providers);

	// Render UI immediately with agent=undefined (will show LoadingScreen)
	const { rerender, waitUntilExit } = renderApp(
		<InkApp
			initialModel={initialModel}
			initialPrompt={initialPrompt}
			agent={undefined}
			enabledProviders={enabledProviders}
		/>
	);

	// Do full initialization in background
	const initBackground = async () => {
		try {
			const { agent } = await createAgent(config, options);

			// Re-render with the fully initialized agent
			rerender(
				<InkApp
					initialModel={initialModel}
					initialPrompt={initialPrompt}
					agent={agent}
					enabledProviders={enabledProviders}
				/>
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
    tiny-agent trace <prompt>          Run a prompt and show observability metadata
    tiny-agent trace --mock <prompt>   Run the observability demo with a mock provider (no API key)
    tiny-agent config                  Show current configuration
    tiny-agent config open             Open config file in editor
    tiny-agent status                  Show provider and model capabilities
    tiny-agent login [provider]        Connect an LLM provider (onboarding)
    tiny-agent logout [provider]       Remove a provider's API key
    tiny-agent memory [command]        Manage memories
    tiny-agent skill [command]         Manage skills
    tiny-agent mcp [command]           Manage MCP servers
    tiny-agent hooks [command]         Manage lifecycle hooks (e.g. plannotator)
    tiny-agent review                  Review the current plan using configured hooks
    tiny-agent plan <task>             Generate a plan for a task
    tiny-agent build                   Execute the build plan from state file
    tiny-agent explore [task]          Explore and analyze codebase
    tiny-agent run-plan-build <task>   Run plan then build in sequence
    tiny-agent run-all <task>          Run plan, build, and explore in sequence
    tiny-agent state show              Show current state file
    tiny-agent state clear             Clear/reset state file
    tiny-agent plan show               Show the current plan
    tiny-agent tasks                   List all tasks with status
    tiny-agent todo                    Show current active task

COMMANDS:
    memory list                        List all stored memories
    memory add <content>               Add a new memory
    memory clear                       Clear all memories
    memory stats                       Show memory statistics
    skill list                         List all discovered skills
    skill show <name>                  Show full skill content
    skill init <name>                  Initialize a new skill
    mcp list                           List configured MCP servers
    mcp add <name> <cmd> [args...]     Add a new MCP server
    mcp enable <name>                  Enable an MCP server
    mcp disable <name>                 Disable an MCP server
    hooks list                         List all configured hooks
    hooks presets                      List available hook presets
    hooks install <preset>             Install a preset (e.g. plannotator)
    hooks enable <name>                Enable a hook
    hooks disable <name>               Disable a hook
    hooks remove <name>                Remove a hook
    state show                         Show current state file (JSON)
    state clear                        Clear/reset state file
    plan show                          Show the current plan
    tasks                              List all tasks with status
    todo                               Show current active task

OPTIONS:
    --model <model>                    Override default model
    --provider <provider>              Override provider (openai|anthropic|ollama|openrouter|opencode|zai|clinepass|qwencloud)
    --verbose, -v                      Enable verbose logging
    --save                             Save conversation to file
    --no-memory                        Disable memory (enabled by default)
    --no-track-context                 Disable context tracking (enabled by default)
    --no-status                        Disable status line
    --agents-md <path>                 Path to AGENTS.md file (auto-detected in cwd)
    --skills-dir <path>                Add a skill directory (can be used multiple times)
    --no-color                         Disable colored output (for pipes/non-TTY)
    --json                             Output messages as JSON (for programmatic use)
    --state-file <path>                Path to state file (default: .tiny-state.json)
    --allow-all, -y                    Auto-approve all tool executions
    --upgrade                          Upgrade to the latest version
    --help, -h                         Show this help message

EXAMPLES:
    tiny-agent                         Start interactive chat
    tiny-agent chat                    Start interactive chat explicitly
    tiny-agent run "Fix this bug"      Run a single prompt
    tiny-agent run --model claude-3-5-sonnet "Help me"  Use specific model
    tiny-agent config                  Show current configuration
    tiny-agent config open             Open config in editor
    tiny-agent login                   Connect a provider interactively
    tiny-agent login openai            Connect OpenAI directly
    tiny-agent logout openai           Remove OpenAI's API key
    tiny-agent login status            Show provider connection status
    tiny-agent logout status           Show provider connection status
    tiny-agent hooks install plannotator  Install plannotator plan review
    tiny-agent review                  Review current plan with hooks
    tiny-agent status                  Show provider and model capabilities
    tiny-agent --upgrade               Upgrade to the latest version
    tiny-agent --help                  Show this help message
    tiny-agent --no-memory run "Help me"  Run without memory
    tiny-agent --no-track-context run "Help me"  Run without context tracking
    tiny-agent --agents-md ./AGENTS.md run "Help me"  Run with AGENTS.md
    tiny-agent memory add "I prefer TypeScript"  Add a memory
    tiny-agent memory list             List all memories
    tiny-agent plan "Create a new API endpoint"  Generate a plan
    tiny-agent run-plan-build "Add user authentication"  Plan and build
    tiny-agent state show              Show current state file

CONFIG:
    ~/.tiny-agent/config.yaml          Configuration file
    tiny-agent config open             Open config in editor

For more information, visit: https://github.com/jellydn/tiny-coding-agent
  `);
}

export async function main(): Promise<void> {
	// Register the main.tsx-local handlers (handleRun, handleInteractiveChat)
	// with the dispatch table. Done inside main() rather than at module level
	// to avoid TDZ issues when command-dispatch.ts is loaded transitively
	// (e.g. by tests) without main.tsx being the entry point.
	registerMainHandlers(handleRun, handleInteractiveChat);

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

		if (options.upgrade) {
			await handleUpgrade();
			return;
		}

		// Pre-config commands (login, logout) run before loadConfig() because
		// the user may be onboarding with no valid provider configured yet.
		const handled = await dispatchPreConfig(command, args, options);
		if (handled) return;

		const config = loadConfig();

		await dispatchCommand(command, { config, args, options });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Error: ${message}`);
		process.exit(1);
	}
}
