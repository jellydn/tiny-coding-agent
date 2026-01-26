import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import { AGENT_CONFIG } from "../config/constants.js";
import { useStatusLine } from "../contexts/StatusLineContext.js";
import type { AgentType } from "../types/enums.js";

interface AgentSwitcherProps {
	onAgentSelect?: (agent: AgentType) => void;
}

const AGENTS: { id: AgentType; label: string; shortcut: string }[] = [
	{ id: "default", label: "Default", shortcut: "1" },
	{ id: "plan", label: "Plan", shortcut: "2" },
	{ id: "build", label: "Build", shortcut: "3" },
	{ id: "explore", label: "Explore", shortcut: "4" },
];

export function AgentSwitcher({ onAgentSelect }: AgentSwitcherProps): React.ReactElement {
	const context = useStatusLine();
	const [selectedIndex, setSelectedIndex] = useState(() => {
		const current = context.currentAgent ?? "default";
		const index = AGENTS.findIndex((a) => a.id === current);
		return index >= 0 ? index : 0;
	});

	useInput((_input, key) => {
		if (key.ctrl && key.return) {
			const num = parseInt(_input, 10);
			if (num >= 1 && num <= 4) {
				const index = num - 1;
				const agent = AGENTS[index]?.id;
				if (agent) {
					setSelectedIndex(index);
					context.setCurrentAgent(agent);
					onAgentSelect?.(agent);
				}
			}
		} else if (key.leftArrow) {
			setSelectedIndex((prev) => (prev === 0 ? AGENTS.length - 1 : prev - 1));
		} else if (key.rightArrow) {
			setSelectedIndex((prev) => (prev === AGENTS.length - 1 ? 0 : prev + 1));
		} else if (key.return) {
			const agent = AGENTS[selectedIndex]?.id;
			if (agent) {
				context.setCurrentAgent(agent);
				onAgentSelect?.(agent);
			}
		}
	});

	return (
		<Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
			<Box marginBottom={1}>
				<Text bold color="gray">
					Agent (←/→ to navigate, Enter to select, Ctrl+1-4)
				</Text>
			</Box>
			<Box>
				{AGENTS.map((agent, index) => {
					const isSelected = index === selectedIndex;
					const agentConfig = AGENT_CONFIG.LABELS[agent.id];
					const agentColor = AGENT_CONFIG.COLORS[agent.id];
					const isCurrent = agent.id === (context.currentAgent ?? "default");

					return (
						<Box key={agent.id} marginRight={1}>
							<Text inverse={isSelected} color={isSelected ? agentColor : undefined} bold={isSelected}>
								{isSelected ? "[" : " "}
							</Text>
							<Text
								color={isSelected ? agentColor : "gray"}
								bold={isSelected || isCurrent}
								dimColor={!isSelected && !isCurrent}
							>
								{agentConfig}
							</Text>
							<Text color={isSelected ? agentColor : undefined} bold={isSelected}>
								{isSelected ? "]" : " "}
							</Text>
							{isCurrent && !isSelected && <Text color="green"> ✓</Text>}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
