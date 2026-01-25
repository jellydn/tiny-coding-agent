import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";
import type React from "react";
import { memo } from "react";
import type { ToolCallStatus } from "./ToolCall.js";

export interface ToolSummary {
	name: string;
	args: Record<string, unknown>;
	status: ToolCallStatus;
	duration?: number;
}

interface ToolsPanelProps {
	tools: ToolSummary[];
	onClose?: () => void;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_ICONS = {
	success: "[✓]",
	error: "[✗]",
	pending: "[pending]",
} as const;

const STATUS_COLORS = {
	success: "green",
	error: "red",
	pending: "yellow",
} as const;

function getStatusIcon(status: ToolCallStatus): string {
	return STATUS_ICONS[status];
}

function getStatusColor(status: ToolCallStatus): string {
	return STATUS_COLORS[status];
}

function getArgPreview(args: Record<string, unknown>, maxLen = 40): string {
	if (!args || Object.keys(args).length === 0) return "";
	const entries = Object.entries(args).filter(([, v]) => v !== undefined);
	if (entries.length === 0) return "";

	const first = entries[0];
	if (!first) return "";
	const [key, value] = first;
	const str = typeof value === "string" ? value : JSON.stringify(value);
	const truncated = str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
	return `${key}="${truncated}"`;
}

export const ToolsPanel = memo(function ToolsPanel({ tools, onClose }: ToolsPanelProps): React.ReactElement {
	if (tools.length === 0) {
		return (
			<Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
				<Text dimColor>No tools executed</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
			<Box justifyContent="space-between" marginBottom={1}>
				<Text color="cyan" bold>
					Tools ({tools.length})
				</Text>
				{onClose && <Text dimColor>[Enter] to close</Text>}
			</Box>

			{tools.map((tool, idx) => {
				const statusIcon = getStatusIcon(tool.status);
				const statusColor = getStatusColor(tool.status);
				const argPreview = getArgPreview(tool.args);
				const isPending = tool.status === "pending";

				return (
					<Box key={`${tool.name}-${idx}`} gap={1}>
						<Text dimColor>{String(idx + 1).padStart(2, " ")}.</Text>
						{isPending ? (
							<Text color={statusColor}>
								<InkSpinner type="dots" />
							</Text>
						) : (
							<Text color={statusColor}>{statusIcon}</Text>
						)}
						<Text bold>{tool.name.padEnd(16)}</Text>
						<Text dimColor>{argPreview}</Text>
						{tool.duration !== undefined && !isPending && (
							<Text dimColor>{formatDuration(tool.duration).padStart(8)}</Text>
						)}
					</Box>
				);
			})}
		</Box>
	);
});
