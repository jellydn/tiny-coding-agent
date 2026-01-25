import { Box, Text, useInput } from "ink";
import type React from "react";
import { useMemo, useState } from "react";
import type { SkillMetadata } from "../../skills/types.js";

interface SkillPickerProps {
	skills: SkillMetadata[];
	filter?: string;
	onSelect: (skill: SkillMetadata) => void;
	onClose: () => void;
}

export function SkillPicker({ skills, filter = "", onSelect, onClose }: SkillPickerProps): React.ReactElement {
	const [selectedIndex, setSelectedIndex] = useState(0);

	const filteredSkills = useMemo(() => {
		if (!filter) return skills;
		const lowerFilter = filter.toLowerCase();
		return skills.filter(
			(s) => s.name.toLowerCase().includes(lowerFilter) || s.description.toLowerCase().includes(lowerFilter)
		);
	}, [skills, filter]);

	useInput((_input, key) => {
		if (key.escape) {
			onClose();
			return;
		}

		if (key.upArrow) {
			setSelectedIndex((prev) => Math.max(0, prev - 1));
			return;
		}

		if (key.downArrow) {
			setSelectedIndex((prev) => Math.min(filteredSkills.length - 1, prev + 1));
			return;
		}

		if (key.return && filteredSkills.length > 0) {
			const selected = filteredSkills[selectedIndex];
			if (selected) {
				onSelect(selected);
			}
			return;
		}
	});

	if (filteredSkills.length === 0) {
		return (
			<Box flexDirection="column" paddingX={1}>
				<Text color="gray">No skills found{filter ? ` matching "${filter}"` : ""}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" paddingX={1}>
			<Text color="gray" dimColor>
				Select a skill (↑↓ to navigate, Enter to select, Esc to cancel):
			</Text>
			{filteredSkills.map((skill, index) => {
				const isSelected = index === selectedIndex;
				const truncatedDesc =
					skill.description.length > 50 ? `${skill.description.slice(0, 47)}...` : skill.description;

				return (
					<Box key={skill.name} flexDirection="row" gap={1}>
						<Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "▶" : " "}</Text>
						<Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
							@{skill.name}
						</Text>
						<Text color="gray" dimColor>
							- {truncatedDesc}
						</Text>
						{skill.isBuiltin && (
							<Text color="yellow" dimColor>
								[builtin]
							</Text>
						)}
					</Box>
				);
			})}
		</Box>
	);
}
