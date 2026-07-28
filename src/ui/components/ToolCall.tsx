import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";
import type React from "react";
import { memo, useMemo } from "react";
import type { ToolCallStatus } from "./tool-status.js";
import { formatDuration, getStatusColor, getStatusIcon } from "./tool-status.js";

export type { ToolCallStatus } from "./tool-status.js";

export interface ToolCallProps {
	name: string;
	args: Record<string, unknown>;
	status: ToolCallStatus;
	error?: string;
	duration?: number;
}

function formatArgValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

export const ToolCall = memo(function ToolCall({
	name,
	args,
	status,
	error,
	duration,
}: ToolCallProps): React.ReactElement {
	const statusIcon = getStatusIcon(status);
	const statusColor = getStatusColor(status);
	const isPending = status === "pending";

	const argsString = useMemo(() => {
		if (!args || Object.keys(args).length === 0) return "";
		return Object.entries(args)
			.filter(([, v]) => v !== undefined)
			.map(([key, value]) => `${key}: ${formatArgValue(value)}`)
			.join(" ");
	}, [args]);

	return (
		<Box>
			{isPending ? (
				<Text color={statusColor}>
					<InkSpinner type="dots" />
				</Text>
			) : (
				<Text color={statusColor}>{statusIcon}</Text>
			)}
			<Text bold> {name}</Text>
			{argsString && <Text dimColor> {argsString}</Text>}
			{isPending && <Text dimColor> (pending)</Text>}
			{!isPending && duration !== undefined && <Text dimColor> ({formatDuration(duration)})</Text>}
			{status === "error" && error && <Text color="red"> Error: {error}</Text>}
		</Box>
	);
});
