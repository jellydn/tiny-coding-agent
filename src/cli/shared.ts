import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config, McpServerConfig } from "../config/schema.js";
import { Agent } from "../core/agent.js";
import { MemoryStore } from "../core/memory.js";
import { globToRegex, McpManager } from "../mcp/manager.js";
import { createProvider } from "../providers/factory.js";
import type { LLMClient } from "../providers/types.js";
import { bashTool, createSkillTool, fileTools, loadPlugins, searchTools, webSearchTool } from "../tools/index.js";
import { ToolRegistry } from "../tools/registry.js";
import { statusLineManager } from "../ui/index.js";

export interface CliOptions {
	model?: string;
	provider?: string;
	verbose?: boolean;
	save?: boolean;
	help?: boolean;
	upgrade?: boolean;
	noMemory?: boolean;
	noTrackContext?: boolean;
	noStatus?: boolean;
	agentsMd?: string;
	allowAll?: boolean;
	noColor?: boolean;
	json?: boolean;
	skillsDir?: string[];
	memoryFile?: string;
	mock?: boolean;
	stateFile?: string;
}

export interface ParsedArgs {
	command: string;
	args: string[];
	options: CliOptions;
}

export function parseArgs(args: string[] = process.argv.slice(2)): ParsedArgs {
	const options: CliOptions = {};
	const positionalArgs: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		switch (arg) {
			case "--help":
			case "-h":
				options.help = true;
				break;
			case "--upgrade":
				options.upgrade = true;
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
			case "--mock":
				options.mock = true;
				break;
			case "--state-file":
				options.stateFile = args[++i];
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

export async function createLLMClient(config: Config, options: CliOptions): Promise<LLMClient> {
	const model = options.model || config.defaultModel;
	const provider = options.provider;

	return createProvider({
		model,
		provider: provider as undefined | "openai" | "anthropic" | "ollama" | "openrouter" | "opencode" | "zai",
		providers: config.providers,
	});
}

export function createMemoryStore(config: Config, options: CliOptions): MemoryStore | undefined {
	const memoryFile = options.memoryFile || config.memoryFile;
	if (!memoryFile && !options.noMemory) {
		return undefined;
	}
	return new MemoryStore({
		filePath: memoryFile || `${process.env.HOME}/.tiny-agent/memories.json`,
	});
}

export async function setupTools(
	config: Config
): Promise<{ registry: ToolRegistry; mcpManager: McpManager | undefined }> {
	const registry = new ToolRegistry();
	const isMcpDisabled = (name: string): boolean =>
		config.disabledMcpPatterns?.length && name.startsWith("mcp_")
			? config.disabledMcpPatterns.some((p) => globToRegex(p).test(name))
			: false;

	const isToolEnabled = (name: string): boolean =>
		!isMcpDisabled(name) &&
		(config.tools === undefined || config.tools[name] === undefined || config.tools[name]?.enabled);

	for (const tool of fileTools) if (isToolEnabled(tool.name)) registry.register(tool);
	if (isToolEnabled(bashTool.name)) registry.register(bashTool);
	for (const tool of searchTools) if (isToolEnabled(tool.name)) registry.register(tool);
	if (isToolEnabled(webSearchTool.name)) registry.register(webSearchTool);

	try {
		for (const tool of await loadPlugins()) if (isToolEnabled(tool.name)) registry.register(tool);
	} catch (err) {
		console.error(`Warning: Failed to load plugins: ${(err as Error).message}`);
	}

	let mcpManager: McpManager | undefined;
	if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
		mcpManager = new McpManager({ disabledPatterns: config.disabledMcpPatterns ?? [] });

		for (const [name, cfg] of Object.entries(config.mcpServers) as [string, McpServerConfig][]) {
			await mcpManager.addServer(name, cfg);
		}

		const allTools = mcpManager.getAllTools();
		for (const [server, toolDefs] of allTools) {
			for (const toolDef of toolDefs) {
				const tool = mcpManager.createToolFromMcp(server, toolDef);
				if (isToolEnabled(tool.name)) {
					try {
						registry.register(tool);
					} catch (err) {
						console.error(`Warning: Failed to register MCP tool: ${(err as Error).message}`);
					}
				}
			}
		}

		const connected = mcpManager.getServerStatus().filter((s) => s.connected && s.toolCount > 0).length;
		statusLineManager.setMcpServerCount(connected);
	}

	return { registry, mcpManager };
}

/**
 * Create a fully-wired Agent from the loaded config + CLI options.
 *
 * This consolidates the ~30-line construction sequence that was duplicated
 * between handleRun() and handleInteractiveChat() in main.tsx:
 * createLLMClient → setupTools → derive options → new Agent(...) →
 * createSkillTool → register → waitForSkills.
 *
 * Returns the agent plus the tool registry and MCP manager so callers can
 * display initialization info (tool count, MCP status) before using the agent.
 */
export async function createAgent(
	config: Config,
	options: CliOptions
): Promise<{
	agent: Agent;
	mcpManager: McpManager | undefined;
	toolRegistry: ToolRegistry;
	agentsMdPath: string | undefined;
}> {
	const llmClient = await createLLMClient(config, options);
	const { registry: toolRegistry, mcpManager } = await setupTools(config);

	const enableMemory = !options.noMemory || config.memoryFile !== undefined;
	const maxContextTokens = config.maxContextTokens ?? (enableMemory ? 32000 : undefined);

	const agentsMdPath =
		options.agentsMd ?? (existsSync(join(process.cwd(), "AGENTS.md")) ? join(process.cwd(), "AGENTS.md") : undefined);

	const skillDirectories = options.skillsDir
		? [...(config.skillDirectories || []), ...options.skillsDir]
		: config.skillDirectories;

	const agent = new Agent(llmClient, toolRegistry, {
		verbose: options.verbose,
		systemPrompt: config.systemPrompt,
		conversationFile: options.save ? config.conversationFile || "conversation.json" : undefined,
		maxContextTokens,
		memoryFile: enableMemory ? config.memoryFile || `${process.env.HOME}/.tiny-agent/memories.json` : undefined,
		maxMemoryTokens: config.maxMemoryTokens,
		trackContextUsage: !options.noTrackContext || config.trackContextUsage,
		agentsMdPath,
		thinking: config.thinking,
		providerConfigs: config.providers,
		observability: config.observability,
		skillDirectories,
		mcpManager,
	});

	const skillTool = createSkillTool(agent.getSkillRegistry(), (allowedTools) => {
		agent._setSkillRestriction(allowedTools);
	});
	toolRegistry.register(skillTool);

	// Wait for skills to be initialized before returning
	await agent.waitForSkills();

	return { agent, mcpManager, toolRegistry, agentsMdPath };
}

export async function openEditor(): Promise<void> {
	const { getConfigPath } = await import("../config/loader.js");
	const configPath = getConfigPath();

	const editor = process.env.EDITOR || process.env.VISUAL || "code";
	const editorArgs: string[] = [];

	if (editor === "code") {
		editorArgs.push("--wait");
	}

	editorArgs.push(configPath);

	const { spawn } = await import("node:child_process");
	const proc = spawn(editor, editorArgs, {
		stdio: "inherit",
		shell: true,
	});

	proc.on("error", (err: Error) => {
		console.error(`Failed to open editor: ${err.message}`);
		console.error(`Config file: ${configPath}`);
		process.exit(1);
	});

	proc.on("close", (code: number) => {
		process.exit(code);
	});
}
