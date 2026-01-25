import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillMetadata } from "../../skills/types.js";

export interface Command {
	name: string;
	description: string;
}

interface CommandMenuProps {
	filter?: string;
	onSelect: (command: Command) => void;
	onClose: () => void;
	skillItems?: SkillMetadata[];
}

const STATIC_COMMANDS: Command[] = [
	{ name: "/help", description: "Show available commands" },
	{ name: "/clear", description: "Clear the conversation" },
	{ name: "/model", description: "Switch the model" },
	{ name: "/tools", description: "View tool executions" },
	{ name: "/mcp", description: "Show MCP server status" },
	{ name: "/memory", description: "List memories" },
	{ name: "/exit", description: "Exit the session" },
	{
		name: "/skill",
		description: "List skills",
	},
];

export function CommandMenu({ filter = "", onSelect, onClose, skillItems = [] }: CommandMenuProps): React.ReactElement {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const prevFilterRef = useRef(filter);

	const isSkillFilter = filter.toLowerCase().startsWith("skill");

	const skillNameFilter = isSkillFilter ? filter.slice(5).toLowerCase() : "";

	const filteredCommands = useMemo(() => {
		if (isSkillFilter && skillItems.length > 0) {
			return skillItems
				.filter((skill) => skill.name.toLowerCase().includes(skillNameFilter))
				.map((skill) => ({
					name: `/skill ${skill.name}`,
					description: skill.description,
				}));
		}
		return STATIC_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(filter.toLowerCase()));
	}, [filter, skillItems, isSkillFilter, skillNameFilter]);

	useEffect(() => {
		if (filter !== prevFilterRef.current) {
			prevFilterRef.current = filter;
			setSelectedIndex(0);
		}
	}, [filter]);

	useInput(
		(_input, key) => {
			if (key.downArrow) {
				setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
			} else if (key.upArrow) {
				setSelectedIndex((prev) => Math.max(prev - 1, 0));
			} else if (key.return) {
				const selectedCommand = filteredCommands[selectedIndex];
				if (selectedCommand) {
					onSelect(selectedCommand);
				}
			} else if (key.escape) {
				onClose();
			}
		},
		{ isActive: true }
	);

	if (filteredCommands.length === 0) {
		return (
			<Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
				<Text color="gray">No commands found</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
			{filteredCommands.map((cmd, index) => (
				<Box key={cmd.name}>
					<Text>
						{index === selectedIndex ? (
							<Text inverse color="blue">
								{" "}
								▼{" "}
							</Text>
						) : (
							<Text> </Text>
						)}
					</Text>
					<Text bold color={index === selectedIndex ? "blue" : undefined}>
						{cmd.name}
					</Text>
					<Text color="gray"> {cmd.description}</Text>
				</Box>
			))}
		</Box>
	);
}
