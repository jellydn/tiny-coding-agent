import { Box, render, useInput } from "ink";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent } from "@/core/agent.js";
import type { SkillMetadata } from "../skills/types.js";
import { ChatLayout } from "./components/ChatLayout.js";
import type { EnabledProviders } from "./components/ModelPicker.js";
import { ChatProvider, useChatContext } from "./contexts/ChatContext.js";
import { StatusLineProvider } from "./contexts/StatusLineContext.js";
import { ToastProvider, useToastContext } from "./contexts/ToastContext.js";
import { useCommandHandler } from "./hooks/useCommandHandler.js";
import { MessageRole } from "./types/enums.js";
import { formatTimestamp } from "./utils.js";

export function ChatApp(): React.ReactElement {
	const [inputValue, setInputValue] = useState("");
	const [showModelPicker, setShowModelPicker] = useState(false);
	const [showToolsPanel, setShowToolsPanel] = useState(false);
	const {
		messages,
		addMessage,
		isThinking,
		currentModel,
		setCurrentModel,
		streamingText,
		sendMessage,
		clearMessages,
		cancelActiveRequest,
		enabledProviders,
		agent,
		currentToolExecutions,
	} = useChatContext();
	const { addToast } = useToastContext();

	const { handleCommandSelect, handleSlashCommand } = useCommandHandler({
		onAddMessage: addMessage,
		onClearMessages: clearMessages,
		onSetShowModelPicker: setShowModelPicker,
		onSetShowToolsPanel: currentToolExecutions.length > 0 ? setShowToolsPanel : undefined,
		onExit: () => process.exit(0),
		agent,
	});

	const [skillItems, setSkillItems] = useState<SkillMetadata[]>([]);
	const [isInitialized, setIsInitialized] = useState(false);
	const skillInvokedThisMessageRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (!agent || isInitialized) return;
		const initAgent = async () => {
			try {
				addToast("Connecting to MCP servers...", "info");

				await agent.waitForSkills();
				const skills = Array.from(agent.getSkillRegistry().values());
				setSkillItems(skills);
				setIsInitialized(true);

				const toolCount = agent.getToolCount();
				if (toolCount > 0) {
					addToast(`${toolCount} tools loaded`, "success");
				}

				const mcpServers = await agent.getMcpServerStatus();
				const mcpConnected = mcpServers.filter((s) => s.connected);
				if (mcpConnected.length > 0) {
					addToast(`${mcpConnected.length} MCP server${mcpConnected.length > 1 ? "s" : ""} connected`, "success");
				} else {
					addToast("No MCP servers configured", "info");
				}

				if (skills.length > 0) {
					addToast(`${skills.length} skills loaded`, "success");
				}
			} catch {}
		};
		initAgent();
	}, [agent, isInitialized, addToast]);

	useInput(
		(_input, key) => {
			if (key.escape && isThinking && inputValue === "") {
				cancelActiveRequest();
				addMessage(MessageRole.ASSISTANT, "\nCancelled. Type a new message or /exit to quit.");
			}
		},
		{ isActive: isThinking }
	);

	const handleInputChange = useCallback((value: string) => {
		setInputValue(value);
	}, []);

	const handleInputSubmit = useCallback(
		async (value: string) => {
			const trimmed = value.trim();
			if (!trimmed || isThinking) return;

			skillInvokedThisMessageRef.current.clear();

			if (trimmed.startsWith("/")) {
				setInputValue("");
				handleSlashCommand(trimmed);
				return;
			}

			setInputValue("");
			await sendMessage(trimmed);
		},
		[isThinking, sendMessage, handleSlashCommand]
	);

	const handleModelSelect = useCallback(
		(modelId: string) => {
			if (modelId && modelId !== currentModel) {
				setCurrentModel(modelId);
				addMessage(MessageRole.SEPARATOR, formatTimestamp());
				const displayName = modelId.replace(/^opencode\//, "");
				addMessage(MessageRole.ASSISTANT, `Model changed to: ${displayName}`);
			}
			setShowModelPicker(false);
		},
		[addMessage, currentModel, setCurrentModel]
	);

	const handleSkillSelect = useCallback(
		async (skill: SkillMetadata) => {
			if (!agent) {
				addMessage(MessageRole.ASSISTANT, "Error: Agent not initialized.");
				return;
			}

			if (skillInvokedThisMessageRef.current.has(skill.name)) {
				return;
			}
			skillInvokedThisMessageRef.current.add(skill.name);

			try {
				const result = await agent.loadSkill(skill.name);
				if (!result) {
					addMessage(MessageRole.ASSISTANT, `Error: Skill not found: ${skill.name}`);
					return;
				}

				const { allowedTools } = result;
				if (allowedTools) {
					addMessage(
						MessageRole.ASSISTANT,
						`Loaded skill: **@${skill.name}**\nRestricted tools to: ${allowedTools.join(", ")}`
					);
				} else {
					addMessage(MessageRole.ASSISTANT, `Loaded skill: **@${skill.name}**\nAll tools available.`);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				addMessage(MessageRole.ASSISTANT, `Error loading skill: ${message}`);
			}
		},
		[agent, addMessage]
	);

	return (
		<Box flexDirection="column" height="100%">
			<ChatLayout
				messages={messages}
				streamingText={isThinking ? streamingText : undefined}
				currentModel={currentModel}
				inputValue={inputValue}
				onInputChange={handleInputChange}
				onInputSubmit={handleInputSubmit}
				onCommandSelect={handleCommandSelect}
				onModelSelect={handleModelSelect}
				onSkillSelect={handleSkillSelect}
				inputDisabled={isThinking}
				showModelPicker={showModelPicker}
				inputPlaceholder={
					isThinking
						? "Waiting... (PgUp/PgDn or scroll to read, ESC to cancel)"
						: "Type a message... (/ for commands, @ for skills)"
				}
				enabledProviders={enabledProviders}
				skillItems={skillItems}
				toolExecutions={currentToolExecutions}
				showToolsPanel={showToolsPanel}
				onSetShowToolsPanel={setShowToolsPanel}
			/>
		</Box>
	);
}

interface AppProps {
	children?: React.ReactNode;
	initialModel?: string;
	initialPrompt?: string;
	agent?: Agent;
	enabledProviders?: EnabledProviders;
}

export function App({ children, initialModel, initialPrompt, agent, enabledProviders }: AppProps): React.ReactElement {
	return (
		<StatusLineProvider>
			<ToastProvider>
				<ChatProvider
					initialModel={initialModel}
					initialPrompt={initialPrompt}
					agent={agent}
					enabledProviders={enabledProviders}
				>
					{children ?? <ChatApp />}
				</ChatProvider>
			</ToastProvider>
		</StatusLineProvider>
	);
}

export function renderApp(element: React.ReactElement) {
	return render(element);
}
