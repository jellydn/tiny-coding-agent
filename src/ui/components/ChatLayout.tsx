import { Box, Text, useInput, useStdout } from "ink";
import React, { useMemo } from "react";
import { ThinkingTagFilter } from "../../cli/main.js";
import type { ToolExecution } from "../../core/agent.js";
import type { SkillMetadata } from "../../skills/types.js";
import { useStatusLine } from "../contexts/StatusLineContext.js";
import { type Command, CommandMenu } from "./CommandMenu.js";
import { Header } from "./Header.js";
import { type ChatMessage, MessageList } from "./MessageList.js";
import {
	DEFAULT_MODELS,
	type EnabledProviders,
	getModelsForProviders,
	ModelPicker,
	type ModelPickerItem,
} from "./ModelPicker.js";
import { SkillPicker } from "./SkillPicker.js";
import { StatusLine } from "./StatusLine.js";
import { TextInput } from "./TextInput.js";
import type { ToolCallStatus } from "./ToolCall.js";
import { type ToolSummary, ToolsPanel } from "./ToolsPanel.js";

function convertToolStatus(status: string): ToolCallStatus {
	switch (status) {
		case "complete":
			return "success";
		case "error":
			return "error";
		default:
			return "pending";
	}
}

interface ChatLayoutProps {
	messages: ChatMessage[];
	streamingText?: string;
	currentModel?: string;
	inputValue: string;
	onInputChange: (value: string) => void;
	onInputSubmit: (value: string) => void;
	onCommandSelect?: (command: Command) => void;
	onModelSelect?: (modelId: string) => void;
	onSkillSelect?: (skill: SkillMetadata) => void;
	inputPlaceholder?: string;
	inputDisabled?: boolean;
	showModelPicker?: boolean;
	enabledProviders?: EnabledProviders;
	skillItems?: SkillMetadata[];
	toolExecutions?: ToolExecution[];
	showToolsPanel?: boolean;
	onSetShowToolsPanel?: (show: boolean) => void;
}

function WelcomeMessage(): React.ReactElement {
	return (
		<Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
			<Text bold color="cyan">
				{`
     ┏┳┓•      ┏┓   ┓•      ┏┓
      ┃ ┓┏┓┓┏  ┃ ┏┓┏┫┓┏┓┏┓  ┣┫┏┓┏┓┏┓╋
      ┻ ┗┛┗┗┫  ┗┛┗┛┗┻┗┛┗┗┫  ┛┗┗┫┗ ┛┗┗
            ┛            ┛     ┛
                     │
              ┌──────┴──────┐
              │  <      />  │
              │             │
              │     ___     │
              └──────┴──────┘
`}
			</Text>
			<Text dimColor>From ITMan.fyi with ❤️</Text>
			<Box marginTop={1}>
				<Text>Type a message, / for commands, @ for skills</Text>
			</Box>
			<Text>/model - Switch model /clear - Clear /exit - Exit</Text>
			<Text>@skill-name - Load a skill</Text>
		</Box>
	);
}

export function ChatLayout({
	messages,
	streamingText,
	currentModel,
	inputValue,
	onInputChange,
	onInputSubmit,
	onCommandSelect,
	onModelSelect,
	onSkillSelect,
	inputPlaceholder,
	inputDisabled,
	showModelPicker = false,
	enabledProviders,
	skillItems = [],
	toolExecutions = [],
	showToolsPanel = false,
	onSetShowToolsPanel,
}: ChatLayoutProps): React.ReactElement {
	const { stdout } = useStdout();
	const terminalWidth = stdout.columns || 80;
	const statusContext = useStatusLine();

	const showCommandMenu = !inputDisabled && inputValue.startsWith("/");
	const commandFilter = showCommandMenu ? inputValue.slice(1) : "";
	const showSkillPicker = !inputDisabled && inputValue.startsWith("@") && skillItems.length > 0;
	const skillFilter = showSkillPicker ? inputValue.slice(1) : "";

	const toolSummaries: ToolSummary[] = useMemo(() => {
		return toolExecutions.map((te) => ({
			name: te.name,
			args: te.args ?? {},
			status: convertToolStatus(te.status),
			duration: te.duration,
		}));
	}, [toolExecutions]);

	const thinkFilterRef = React.useRef(new ThinkingTagFilter());
	const filteredStreamingText = useMemo(() => {
		if (!streamingText) return undefined;
		return thinkFilterRef.current.filter(streamingText);
	}, [streamingText]);

	const hasRunningTool = toolSummaries.some((t) => t.status === "pending");

	useInput(
		(_input, key) => {
			if (key.return && showToolsPanel && onSetShowToolsPanel) {
				onSetShowToolsPanel(false);
			}
		},
		{ isActive: showToolsPanel }
	);

	const availableModels: ModelPickerItem[] = enabledProviders
		? getModelsForProviders(enabledProviders)
		: DEFAULT_MODELS;

	const handleCommandSelect = (command: Command) => {
		if (onCommandSelect) {
			onCommandSelect(command);
		}
		onInputChange("");
	};

	const handleModelSelect = (modelId: string) => {
		if (onModelSelect) {
			onModelSelect(modelId);
		}
	};

	const handleSkillSelect = (skill: SkillMetadata) => {
		if (onSkillSelect) {
			onSkillSelect(skill);
		}
		onInputChange("");
	};

	return (
		<Box flexDirection="column" height="100%">
			<Header model={currentModel} skillCount={skillItems.length} />

			<Box flexDirection="column" flexGrow={1}>
				{messages.length === 0 ? <WelcomeMessage /> : <MessageList messages={messages} />}

				{filteredStreamingText !== undefined && (
					<Box flexDirection="column" marginBottom={1}>
						<Text color="cyan" bold>
							Assistant:
						</Text>
						<Box marginTop={1}>
							<Text wrap="wrap">{filteredStreamingText || "..."}</Text>
						</Box>
					</Box>
				)}

				{!showToolsPanel && hasRunningTool && (
					<Box marginY={1}>
						<Text color="cyan" dimColor>
							[Tools ({toolSummaries.length})] Type /tools to view
						</Text>
					</Box>
				)}

				{showToolsPanel && (
					<Box marginY={1}>
						<ToolsPanel tools={toolSummaries} onClose={() => onSetShowToolsPanel?.(false)} />
					</Box>
				)}
			</Box>

			<Box flexDirection="column" flexShrink={0}>
				<Box width={terminalWidth} borderStyle="single" borderColor="gray" paddingX={1}>
					<StatusLine
						status={statusContext.status}
						model={statusContext.model}
						tokensUsed={statusContext.tokensUsed}
						tokensMax={statusContext.tokensMax}
						tool={statusContext.tool}
						mcpServerCount={statusContext.mcpServerCount}
						currentAgent={statusContext.currentAgent}
					/>
				</Box>

				<Box width={terminalWidth}>
					{showCommandMenu && (
						<CommandMenu
							filter={commandFilter}
							onSelect={handleCommandSelect}
							onClose={() => onInputChange("")}
							skillItems={skillItems}
						/>
					)}
					{showModelPicker && (
						<ModelPicker
							models={availableModels}
							currentModel={currentModel ?? ""}
							onSelect={handleModelSelect}
							onClose={() => onModelSelect?.("")}
						/>
					)}
					{showSkillPicker && (
						<SkillPicker
							skills={skillItems}
							filter={skillFilter}
							onSelect={handleSkillSelect}
							onClose={() => onInputChange("")}
						/>
					)}
					{!showCommandMenu && !showModelPicker && !showSkillPicker && (
						<TextInput
							onChange={onInputChange}
							onSubmit={onInputSubmit}
							placeholder={inputPlaceholder}
							disabled={inputDisabled}
						/>
					)}
				</Box>
			</Box>
		</Box>
	);
}
