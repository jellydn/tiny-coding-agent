import { Box, Text } from "ink";
import type React from "react";
import { memo, useMemo } from "react";
import type { ToolExecution } from "../../core/agent.js";
import { TRUNCATE_LIMITS } from "../config/constants.js";
import { MessageRole, ToolStatus } from "../types/enums.js";
import { SyntaxHighlighted } from "./SyntaxHighlighter.js";
import { formatGitCommand, getStatusColor, getStatusIcon, hasToolMarkers } from "./tool-status.js";

interface InlineToolOutputProps {
	toolExecution: ToolExecution;
}

export const InlineToolOutput = memo(function InlineToolOutput({
	toolExecution,
}: InlineToolOutputProps): React.ReactElement {
	const { name, status, args, output, error } = toolExecution;
	const isComplete = status === ToolStatus.COMPLETE;
	const isError = status === ToolStatus.ERROR;

	const statusIcon = getStatusIcon(status);
	const statusColor = getStatusColor(status);

	const formattedName = formatGitCommand(name, args);
	const argsPreview = useMemo(() => {
		if (!args || Object.keys(args).length === 0) return "";
		return Object.entries(args)
			.filter(([, v]) => v !== undefined)
			.map(([, value]) => {
				const str = typeof value === "string" ? value : JSON.stringify(value);
				return str.length > TRUNCATE_LIMITS.TOOL_ARGS ? `${str.slice(0, TRUNCATE_LIMITS.TOOL_ARGS)}...` : str;
			})
			.join(" ");
	}, [args]);

	const displayOutput = isError ? error : output;

	const truncatedOutput = useMemo(
		() => (displayOutput ? displayOutput.split("\n").slice(0, TRUNCATE_LIMITS.TOOL_OUTPUT_PREVIEW).join("\n") : ""),
		[displayOutput]
	);

	const showMoreIndicator = useMemo(
		() => (displayOutput ? displayOutput.split("\n").length > TRUNCATE_LIMITS.TOOL_OUTPUT_PREVIEW : false),
		[displayOutput]
	);

	const statusText = isError ? "Error" : isComplete ? "Done" : "Running";

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={statusColor} paddingX={1} marginTop={1}>
			<Box>
				<Text color={statusColor}>{statusIcon}</Text>
				<Text color="white" bold>
					{" "}
					{formattedName}
				</Text>
				<Text color="gray"> · {statusText}</Text>
			</Box>

			{argsPreview && (
				<Box marginTop={0}>
					<Text color="dimColor">{argsPreview}</Text>
				</Box>
			)}

			{(isComplete || isError) && displayOutput && (
				<Box flexDirection="column" marginTop={1}>
					<SyntaxHighlighted text={truncatedOutput} />
					{showMoreIndicator && <Text dimColor>...</Text>}
				</Box>
			)}
		</Box>
	);
});

interface MessageProps {
	role: MessageRole;
	content: string;
	toolName?: string;
	toolStatus?: ToolStatus;
	toolArgs?: Record<string, unknown>;
}

export const Message = memo(function Message({
	role,
	content,
	toolName,
	toolStatus,
	toolArgs,
}: MessageProps): React.ReactElement {
	const statusIcon = role === MessageRole.TOOL ? getStatusIcon(toolStatus) : "";
	const statusColor = role === MessageRole.TOOL ? getStatusColor(toolStatus) : "";

	const toolArgsStr = useMemo(
		() =>
			toolArgs && Object.keys(toolArgs).length > 0
				? Object.entries(toolArgs)
						.filter(([, v]) => v !== undefined)
						.map(([, value]) => {
							const str = typeof value === "string" ? value : JSON.stringify(value);
							const truncated =
								str.length > TRUNCATE_LIMITS.TOOL_ARGS ? `${str.slice(0, TRUNCATE_LIMITS.TOOL_ARGS)}...` : str;
							return ` =${truncated}`;
						})
						.join("")
				: "",
		[toolArgs]
	);

	const truncatedContent = useMemo(
		() => (content ? content.split("\n").slice(0, TRUNCATE_LIMITS.TOOL_OUTPUT_INLINE).join("\n") : ""),
		[content]
	);

	const showContentMore = useMemo(
		() => (content ? content.split("\n").length > TRUNCATE_LIMITS.TOOL_OUTPUT_INLINE : false),
		[content]
	);

	if (role === MessageRole.TOOL) {
		return (
			<Box flexDirection="column" marginLeft={2} marginTop={1}>
				<Box alignItems="center">
					<Text color="gray">├</Text>
					<Text color={statusColor}> {statusIcon}</Text>
					<Text color="white" bold>
						{" "}
						{toolName}
					</Text>
					{toolArgsStr && <Text dimColor>{toolArgsStr}</Text>}
				</Box>
				{content && toolStatus !== ToolStatus.RUNNING && (
					<Box marginLeft={2}>
						<Text dimColor={toolStatus === ToolStatus.ERROR} wrap="wrap">
							{truncatedContent}
							{showContentMore && "\n..."}
						</Text>
					</Box>
				)}
			</Box>
		);
	}

	if (role === MessageRole.SEPARATOR) {
		return (
			<Box marginY={1}>
				<Text color="gray">────────────────────────────── </Text>
				<Text color="gray" dimColor>
					{content}
				</Text>
				<Text color="gray"> ──────────────────────────────</Text>
			</Box>
		);
	}

	const label = role === MessageRole.USER ? "You:" : "Assistant:";
	const color = role === MessageRole.USER ? "green" : "cyan";

	const hasToolOutput = role === MessageRole.ASSISTANT && hasToolMarkers(content);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={color} bold>
				{label}
			</Text>
			<Box marginTop={1}>
				{hasToolOutput ? (
					<SyntaxHighlighted text={content || "(no content)"} />
				) : (
					<Text wrap="wrap">{content || "(no content)"}</Text>
				)}
			</Box>
		</Box>
	);
});
