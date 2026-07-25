import { useCallback } from "react";
import { readStateFile } from "../../agents/state.js";
import type { Agent } from "../../core/agent.js";
import type { McpManager } from "../../mcp/manager.js";
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

			const stateResult = await readStateFile(stateFile, { ignoreMissing: true });

			if (!stateResult.success || !stateResult.data) {
				onAddMessage(MessageRole.ASSISTANT, "No state file found. Run 'tiny-agent plan <task>' first.");
				return;
			}

			const state = stateResult.data;

			if (subcommand === "show") {
				if (state.results?.plan?.plan) {
					onAddMessage(MessageRole.ASSISTANT, `**Current Plan**\n\n${state.results.plan.plan}`);
				} else {
					onAddMessage(
						MessageRole.ASSISTANT,
						"No plan found in state file.\n\nRun 'tiny-agent plan <task>' to generate a plan first."
					);
				}
			} else if (subcommand === "tasks") {
				const steps = state.results?.build?.steps;

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
				const steps = state.results?.build?.steps;
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

	const handleCommand = useCallback(
		(commandName: string, args: string = "") => {
			switch (commandName) {
				case "/clear":
					onClearMessages();
					onAddMessage(MessageRole.ASSISTANT, "Conversation cleared.");
					break;
				case "/exit":
					onExit();
					break;
				case "/help":
					onAddMessage(
						MessageRole.ASSISTANT,
						`Available commands:
  /help    - Show this help
  /clear   - Clear conversation
  /model   - Switch model
  /agent   - Switch agent
  /tools   - View tool executions
  /mcp     - Show MCP server status
  /memory  - List memories
  /skill   - List skills
  /plan    - Show current plan
  /tasks   - List all tasks with status
  /todo    - Show pending tasks
  /exit    - Exit`
					);
					break;
				case "/model":
					onSetShowModelPicker(true);
					break;
				case "/agent":
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
					break;
				case "/mcp":
					handleMcpCommand();
					break;
				case "/skill":
					handleSkillCommand(args);
					break;
				case "/memory":
					handleMemoryCommand();
					break;
				case "/plan":
				case "/tasks":
				case "/todo":
					handlePlanCommand(args);
					break;
				case "/tools":
					if (onSetShowToolsPanel) {
						onSetShowToolsPanel(true);
					} else {
						onAddMessage(MessageRole.ASSISTANT, "No tools executed yet.");
					}
					break;
				default:
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
			handleMcpCommand,
			handleMemoryCommand,
			handlePlanCommand,
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
