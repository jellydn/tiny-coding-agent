import { loadConfig } from "../config/loader.js";
import { getEnabledProviders, getProviderDisplayName } from "../ui/components/ModelPicker.js";
import { statusLineManager } from "../ui/index.js";
import { StatusType } from "../ui/types/enums.js";
import { isJsonMode, setJsonMode, setNoColor, shouldUseInk } from "../ui/utils.js";
import { dispatchCommand, dispatchPreConfig, registerMainHandlers } from "./command-dispatch.js";
import { handleUpgrade } from "./handlers/upgrade.js";
import { showHelp } from "./help-text.js";
import { type CliOptions, createAgent, parseArgs } from "./shared.js";
import { displayToolExecution, outputJson, ThinkingTagFilter } from "./tool-display.js";

// Re-export for backward compatibility — tests import ThinkingTagFilter
// and formatArgs from main.tsx. The canonical home is now tool-display.ts.
export { formatArgs, ThinkingTagFilter } from "./tool-display.js";

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
						displayToolExecution(te);
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
