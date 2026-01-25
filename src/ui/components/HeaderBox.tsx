import { Box, Text } from "ink";
import type React from "react";

interface HeaderBoxProps {
	model: string;
	provider?: string;
	toolCount: number;
	memoryEnabled: boolean;
	agentsMdLoaded: boolean;
}

export function HeaderBox({
	model,
	provider,
	toolCount,
	memoryEnabled,
	agentsMdLoaded,
}: HeaderBoxProps): React.ReactElement {
	const memoryStatus = memoryEnabled ? "enabled" : "disabled";
	const agentsMdStatus = agentsMdLoaded ? "AGENTS.md loaded" : "no AGENTS.md";
	const providerDisplay = provider ? `${provider} |` : "";

	return (
		<Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
			<Text bold color="cyan">
				Tiny Coding Agent
			</Text>
			<Text>
				<Text color="gray">Model:</Text> <Text color="green">{model}</Text>
			</Text>
			<Text>
				<Text color="gray">Provider:</Text> {providerDisplay} <Text color="gray">Tools:</Text> {toolCount}{" "}
				<Text color="gray">| Memory:</Text> {memoryStatus} <Text color="gray">|</Text> {agentsMdStatus}
			</Text>
			<Text color="gray">Use Ctrl+D or /bye to exit</Text>
			<Text color="gray">Commands: /model, /thinking on|off, /effort low|medium|high</Text>
		</Box>
	);
}
