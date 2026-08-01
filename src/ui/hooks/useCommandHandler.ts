import { useCallback } from "react";
import { formatProviderStatus } from "../../cli/handlers/login.js";
import type { Agent } from "../../core/agent.js";
import type { McpManager } from "../../mcp/manager.js";
import { generateHelpText, resolveCommandAlias } from "../chat-command-registry.js";
import type { Command } from "../components/CommandMenu.js";
import { handlePlanCommand } from "../handlers/plan-handler.js";
import { handleReviewCommand } from "../handlers/review-handler.js";
import { handleSkillCommand } from "../handlers/skill-handler.js";
import { MessageRole } from "../types/enums.js";

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
	const handleSkill = useCallback(
		async (args: string) => handleSkillCommand(args, { agent, onAddMessage }),
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

	const handlePlan = useCallback(async (args: string) => handlePlanCommand(args, { onAddMessage }), [onAddMessage]);

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

	const handleReview = useCallback(async () => handleReviewCommand({ onAddMessage }), [onAddMessage]);

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
				"/skill": () => handleSkill(args),
				"/memory": () => handleMemoryCommand(),
				"/plan": () => handlePlan(args),
				"/review": () => handleReview(),
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
			handleSkill,
			handleLoginCommand,
			handleLogoutCommand,
			handleMcpCommand,
			handleMemoryCommand,
			handlePlan,
			handleReview,
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
