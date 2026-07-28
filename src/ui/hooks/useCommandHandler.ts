import { useCallback } from "react";
import { StateManager } from "../../agents/state-manager.js";
import { formatProviderStatus } from "../../cli/handlers/login.js";
import { readConfigFile } from "../../config/config-io.js";
import { getConfigPath } from "../../config/loader.js";
import type { Agent } from "../../core/agent.js";
import { buildRegistry, hasHooks, runHooks } from "../../hooks/manager.js";
import { PLANNOTATOR_PRESET } from "../../hooks/presets.js";
import type { HookConfig } from "../../hooks/types.js";
import type { McpManager } from "../../mcp/manager.js";
import { generateHelpText, resolveCommandAlias } from "../chat-command-registry.js";
import type { Command } from "../components/CommandMenu.js";
import { MessageRole } from "../types/enums.js";

const DEFAULT_STATE_FILE = ".tiny-state.json";

interface UseCommandHandlerProps {
	onAddMessage: (role: MessageRole, content: string) => void;
	onClearMessages: () => void;
	onSetShowModelPicker: (show: boolean) => void;
	onSetShowAgentSwitcher?: (show: boolean) => void;
	onSetShowToolsPanel?: (show: boolean) => void;
	onExit: () => void;
	agent?: Agent;
	mcpManager?: McpManager | null;
}

export function useCommandHandler({
	onAddMessage,
	onClearMessages,
	onSetShowModelPicker,
	onSetShowAgentSwitcher,
	onSetShowToolsPanel,
	onExit,
	agent,
	mcpManager,
}: UseCommandHandlerProps) {
	const handleSkillCommand = useCallback(
		async (args: string) => {
			const skillName = args.trim();

			if (!skillName) {
				if (!agent) {
					onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot list skills.");
					return;
				}

				const skills = agent.getSkillRegistry();
				const skillList = Array.from(skills.values());

				if (skillList.length === 0) {
					onAddMessage(
						MessageRole.ASSISTANT,
						`No skills available.\n\nUse "tiny-agent skill init <name>" to create a new skill, or configure skillDirectories in your config.yaml.`
					);
				} else {
					const skillDescriptions = skillList.map((s) => `  • **${s.name}**: ${s.description}`).join("\n");
					onAddMessage(
						MessageRole.ASSISTANT,
						`Available skills:\n\n${skillDescriptions}\n\nType @skill-name to load a skill.`
					);
				}
				return;
			}

			if (!agent) {
				onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot load skills.");
				return;
			}

			const skillRegistry = agent.getSkillRegistry();

			if (!skillRegistry.has(skillName)) {
				const availableSkills = Array.from(skillRegistry.keys()).join(", ");
				onAddMessage(
					MessageRole.ASSISTANT,
					`Skill not found: ${skillName}\n\nAvailable skills: ${availableSkills || "none"}\n\nType @skill-name to load a skill.`
				);
				return;
			}

			try {
				const result = await agent.loadSkill(skillName);
				if (!result) {
					const availableSkills = Array.from(skillRegistry.keys()).join(", ");
					onAddMessage(
						MessageRole.ASSISTANT,
						`Skill not found: ${skillName}\n\nAvailable skills: ${availableSkills || "none"}`
					);
					return;
				}

				const { wrappedContent, allowedTools } = result;
				if (allowedTools) {
					onAddMessage(
						MessageRole.ASSISTANT,
						`Loaded skill: **${skillName}**\nRestricted tools to: ${allowedTools.join(", ")}\n\n${wrappedContent}`
					);
				} else {
					onAddMessage(
						MessageRole.ASSISTANT,
						`Loaded skill: **${skillName}**\nAll tools available.\n\n${wrappedContent}`
					);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				onAddMessage(MessageRole.ASSISTANT, `Error loading skill: ${message}`);
			}
		},
		[agent, onAddMessage]
	);

	const handleMcpCommand = useCallback(() => {
		const manager = mcpManager ?? undefined;
		if (!manager) {
			onAddMessage(MessageRole.ASSISTANT, "No MCP servers configured.");
			return;
		}

		const servers = manager.getServerStatus();
		if (servers.length === 0) {
			onAddMessage(MessageRole.ASSISTANT, "No MCP servers registered.");
			return;
		}

		const lines = servers
			.map((s) => {
				const status = s.connected ? "●" : "○";
				const tools = s.toolCount > 0 ? ` (${s.toolCount} tools)` : "";
				return `  ${status} ${s.name}${tools}`;
			})
			.join("\n");

		onAddMessage(MessageRole.ASSISTANT, `MCP Servers:\n\n${lines}\n\nUse a tool from an MCP server to connect it.`);
	}, [mcpManager, onAddMessage]);

	const handlePlanCommand = useCallback(
		async (args: string) => {
			const subcommand = args.trim().toLowerCase() || "show";
			const stateFile = DEFAULT_STATE_FILE;

			const mgr = new StateManager(stateFile);
			const loadResult = await mgr.loadOrFail();
			if (!loadResult.success) {
				onAddMessage(MessageRole.ASSISTANT, "No state file found. Run 'tiny-agent plan <task>' first.");
				return;
			}

			if (subcommand === "show") {
				const plan = mgr.getPlan();
				if (plan) {
					onAddMessage(MessageRole.ASSISTANT, `**Current Plan**\n\n${plan}`);
				} else {
					onAddMessage(
						MessageRole.ASSISTANT,
						"No plan found in state file.\n\nRun 'tiny-agent plan <task>' to generate a plan first."
					);
				}
			} else if (subcommand === "tasks") {
				const steps = mgr.getBuildSteps();

				if (!steps || steps.length === 0) {
					onAddMessage(
						MessageRole.ASSISTANT,
						"No tasks found in state file.\n\nRun 'tiny-agent run-plan-build <task>' to generate tasks first."
					);
					return;
				}

				const taskList = steps
					.map((step) => {
						const icon = step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : "○";
						return `  ${icon} **[${step.stepNumber}]** ${step.description}`;
					})
					.join("\n");

				const completed = steps.filter((s) => s.status === "completed").length;
				const pending = steps.filter((s) => s.status === "pending").length;
				const failed = steps.filter((s) => s.status === "failed").length;

				onAddMessage(
					MessageRole.ASSISTANT,
					`**Tasks** (${completed}/${steps.length} completed, ${pending} pending, ${failed} failed)\n\n${taskList}`
				);
			} else if (subcommand === "todo") {
				const steps = mgr.getBuildSteps();
				const pendingSteps = steps?.filter((s) => s.status === "pending") ?? [];

				if (pendingSteps.length === 0) {
					onAddMessage(MessageRole.ASSISTANT, "No pending tasks. All tasks are completed!");
					return;
				}

				const todoList = pendingSteps.map((step) => `  ○ **[${step.stepNumber}]** ${step.description}`).join("\n");

				onAddMessage(MessageRole.ASSISTANT, `**TODO** (${pendingSteps.length} pending)\n\n${todoList}`);
			} else {
				onAddMessage(
					MessageRole.ASSISTANT,
					`Unknown plan subcommand: ${subcommand}\n\nAvailable: /plan show, /tasks, /todo`
				);
			}
		},
		[onAddMessage]
	);

	const handleLoginCommand = useCallback(() => {
		if (!agent) {
			onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot show provider status.");
			return;
		}

		// Show current provider connection status + onboarding guidance.
		// The actual key entry happens via the top-level `tiny-agent login`
		// command, because the Ink chat UI does not have a secure (masked)
		// text input for secrets.
		const providerConfigs = agent.getProviderConfigs();
		const status = formatProviderStatus(providerConfigs);

		onAddMessage(
			MessageRole.ASSISTANT,
			`${status}\n\n` +
				`To connect a provider, exit and run:\n` +
				`  tiny-agent login          Interactive provider picker\n` +
				`  tiny-agent login openai    Connect a specific provider\n` +
				`  tiny-agent login status    Show this status again`
		);
	}, [agent, onAddMessage]);

	const handleLogoutCommand = useCallback(() => {
		if (!agent) {
			onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot show provider status.");
			return;
		}

		// Show current provider connection status + logout guidance.
		// The actual key removal happens via the top-level `tiny-agent logout`
		// command, because it writes to the config file on disk.
		const providerConfigs = agent.getProviderConfigs();
		const status = formatProviderStatus(providerConfigs);

		onAddMessage(
			MessageRole.ASSISTANT,
			`${status}\n\n` +
				`To remove a provider's API key, exit and run:\n` +
				`  tiny-agent logout          Interactive provider picker\n` +
				`  tiny-agent logout openai   Log out a specific provider\n` +
				`  tiny-agent logout status   Show this status again`
		);
	}, [agent, onAddMessage]);

	const handleMemoryCommand = useCallback(() => {
		if (!agent) {
			onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized.");
			return;
		}

		const memoryStore = agent.getMemoryStore();
		if (!memoryStore) {
			onAddMessage(MessageRole.ASSISTANT, "Memory not configured. Set memoryFile in config.yaml.");
			return;
		}

		const memories = memoryStore.list();
		if (memories.length === 0) {
			onAddMessage(MessageRole.ASSISTANT, "No memories stored.");
		} else {
			const list = memories.map((m) => `  • [${m.category}] ${m.content}`).join("\n");
			onAddMessage(MessageRole.ASSISTANT, `Memories:\n\n${list}`);
		}
	}, [agent, onAddMessage]);

	const handleReviewCommand = useCallback(async () => {
		const stateFile = DEFAULT_STATE_FILE;

		// Load hooks from config file
		let hooks: HookConfig[] = [];
		try {
			const configPath = getConfigPath();
			const fileConfig = await readConfigFile(configPath);
			hooks = (fileConfig.hooks as HookConfig[] | undefined) ?? [];
		} catch {
			onAddMessage(MessageRole.ASSISTANT, "Error: Could not read config file for hooks.");
			return;
		}

		if (hooks.length === 0 || !hasHooks(buildRegistry(hooks), "post-plan-generate")) {
			onAddMessage(
				MessageRole.ASSISTANT,
				"No review hooks configured.\n\n" +
					"To install the plannotator preset, exit and run:\n" +
					"  tiny-agent hooks install plannotator\n\n" +
					"Or add hooks manually in config.yaml."
			);
			return;
		}

		// Load the plan from the state file
		const mgr = new StateManager(stateFile);
		const state = await mgr.loadOrCreate();
		const plan = mgr.getPlan();
		if (!plan) {
			onAddMessage(MessageRole.ASSISTANT, "No plan found in state file. Run 'tiny-agent plan <task>' first.");
			return;
		}

		onAddMessage(MessageRole.ASSISTANT, `📋 Reviewing plan (${plan.length} chars) with configured hooks...`);

		const registry = buildRegistry(hooks);
		const hookResult = await runHooks(registry, "post-plan-generate", {
			event: "post-plan-generate",
			content: plan,
			stateFile,
			taskDescription: state.taskDescription,
		});

		if (hookResult.skipped) {
			onAddMessage(
				MessageRole.ASSISTANT,
				`⚠️ Review hook was skipped (binary not found).\n\n${PLANNOTATOR_PRESET.installInstructions ?? ""}`
			);
			return;
		}

		if (!hookResult.success) {
			onAddMessage(MessageRole.ASSISTANT, `✗ Review hook failed: ${hookResult.error ?? "unknown error"}`);
			return;
		}

		if (hookResult.feedback) {
			onAddMessage(MessageRole.ASSISTANT, `📋 Feedback:\n${hookResult.feedback}`);
		}

		if (hookResult.modifiedContent) {
			mgr.setPlan(hookResult.modifiedContent);
			try {
				await mgr.save();
			} catch {
				/* state write errors are non-fatal */
			}
			onAddMessage(
				MessageRole.ASSISTANT,
				`✓ Plan updated (${hookResult.modifiedContent.length} chars) and saved to ${stateFile}`
			);
		}

		if (hookResult.approved === false) {
			onAddMessage(MessageRole.ASSISTANT, "✗ Plan rejected by reviewer.");
			return;
		}

		onAddMessage(MessageRole.ASSISTANT, "✓ Plan approved by reviewer.");
	}, [onAddMessage]);

	// Dispatch map — each command name maps to a handler function.
	// Aliases (/tasks, /todo → /plan) are resolved via resolveCommandAlias()
	// before dispatch. The /help text is auto-generated from the registry.
	const handleCommand = useCallback(
		(commandName: string, args: string = "") => {
			const canonical = resolveCommandAlias(commandName);

			const dispatchers: Record<string, () => void> = {
				"/clear": () => {
					onClearMessages();
					onAddMessage(MessageRole.ASSISTANT, "Conversation cleared.");
				},
				"/exit": () => onExit(),
				"/help": () => onAddMessage(MessageRole.ASSISTANT, generateHelpText()),
				"/model": () => onSetShowModelPicker(true),
				"/agent": () => {
					if (onSetShowAgentSwitcher) {
						onSetShowAgentSwitcher(true);
					} else {
						onAddMessage(
							MessageRole.ASSISTANT,
							`Available agents:
  • Default - General purpose coding assistant
  • Plan    - Plan and analyze tasks
  • Build   - Execute code changes
  • Explore - Read-only code analysis

Use ←/→ to navigate, Enter to select.`
						);
					}
				},
				"/login": () => handleLoginCommand(),
				"/logout": () => handleLogoutCommand(),
				"/mcp": () => handleMcpCommand(),
				"/skill": () => handleSkillCommand(args),
				"/memory": () => handleMemoryCommand(),
				"/plan": () => handlePlanCommand(args),
				"/review": () => handleReviewCommand(),
				"/tools": () => {
					if (onSetShowToolsPanel) {
						onSetShowToolsPanel(true);
					} else {
						onAddMessage(MessageRole.ASSISTANT, "No tools executed yet.");
					}
				},
			};

			const handler = dispatchers[canonical];
			if (handler) {
				handler();
			} else {
				onAddMessage(MessageRole.ASSISTANT, `Unknown command: ${commandName}`);
			}
		},
		[
			onAddMessage,
			onClearMessages,
			onSetShowModelPicker,
			onSetShowAgentSwitcher,
			onSetShowToolsPanel,
			onExit,
			handleSkillCommand,
			handleLoginCommand,
			handleLogoutCommand,
			handleMcpCommand,
			handleMemoryCommand,
			handlePlanCommand,
			handleReviewCommand,
		]
	);

	const handleCommandSelect = useCallback(
		(command: Command) => {
			const parts = command.name.split(" ");
			const commandName = (parts[0] ?? "") as string;
			const args = parts.length > 1 ? parts.slice(1).join(" ") : "";
			handleCommand(commandName, args);
		},
		[handleCommand]
	);

	const handleSlashCommand = useCallback(
		(commandText: string) => {
			const parts = commandText.trim().split(/\s+/);
			const commandName = parts[0] || "";
			const args = parts.slice(1).join(" ");
			if (commandName) {
				handleCommand(commandName, args);
			}
		},
		[handleCommand]
	);

	return {
		handleCommandSelect,
		handleSlashCommand,
	};
}
