import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillMetadata } from "../../skills/types.js";
import { getCommandList } from "../chat-command-registry.js";

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

// Auto-generated from the chat-command-registry — no more manual sync.
const STATIC_COMMANDS: Command[] = getCommandList();

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
