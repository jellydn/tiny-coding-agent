import { Box, Text } from "ink";
import type React from "react";
import { memo, useMemo } from "react";

/**
 * Syntax highlighting for diff/git output rendered in the CLI.
 * Extracted from Message.tsx to separate the diff renderer (130 lines of
 * regex-driven JSX) from the message routing component.
 */

interface SyntaxHighlightedProps {
	text: string;
}

const SYNTAX_PATTERNS: Array<{ test: (line: string) => boolean; color: string; bold?: boolean }> = [
	{ test: (line) => line.startsWith("[File:"), color: "magenta", bold: true },
	{ test: (line) => line.startsWith("+"), color: "green" },
	{ test: (line) => line.startsWith("-"), color: "red" },
	{ test: (line) => line.startsWith("@@"), color: "magenta" },
	{ test: (line) => line.startsWith("diff --git"), color: "cyan" },
	{ test: (line) => line.startsWith("index "), color: "cyan" },
	{ test: (line) => line.startsWith("--- "), color: "yellow" },
	{ test: (line) => line.startsWith("+++ "), color: "yellow" },
	{ test: (line) => /^\s*\d+\s+files?\s+changed/.test(line), color: "cyan" },
	{ test: (line) => /^\s*\d+\s+insertions?/.test(line), color: "green" },
	{ test: (line) => /^\s*\d+\s+deletions?/.test(line), color: "red" },
	{ test: (line) => /^[a-f0-9]{7,}\s/.test(line), color: "cyan" },
	{ test: (line) => /\([^)]+\)$/.test(line), color: "green" },
	{ test: (line) => /^(On branch |Your branch is)/.test(line), color: "cyan" },
	{
		test: (line) => /^(Changes to be committed:|Changes not staged|Untracked)/.test(line),
		color: "magenta",
		bold: true,
	},
	{ test: (line) => /^(no changes|nothing to)/.test(line), color: "gray" },
	{ test: (line) => line.startsWith("..."), color: "gray" },
];

function getSyntaxStyle(line: string): { color?: string; bold?: boolean } {
	for (const pattern of SYNTAX_PATTERNS) {
		if (pattern.test(line)) return { color: pattern.color, bold: pattern.bold };
	}
	return {};
}

export const SyntaxHighlighted = memo(function SyntaxHighlighted({ text }: SyntaxHighlightedProps): React.ReactElement {
	const lines = useMemo(() => text.split("\n"), [text]);

	const lineElements = useMemo(
		() =>
			lines.map((line, idx) => {
				const style = getSyntaxStyle(line);
				const { color, bold } = style;

				if (line.startsWith("[File:")) {
					return (
						<Text key={idx} color={color} bold={bold}>
							{line}
						</Text>
					);
				}

				const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
				if (diffMatch) {
					return (
						<Text key={idx}>
							<Text color="cyan">diff --git a/</Text>
							<Text color="cyan" bold>
								{diffMatch[1]}
							</Text>
							<Text color="cyan"> b/</Text>
							<Text color="cyan" bold>
								{diffMatch[2]}
							</Text>
						</Text>
					);
				}

				const oldFileMatch = line.match(/^--- (a\/)?(.+)$/);
				if (oldFileMatch) {
					return (
						<Text key={idx}>
							<Text color="yellow">--- {oldFileMatch[1] ?? ""}</Text>
							<Text color="yellow" bold>
								{oldFileMatch[2]}
							</Text>
						</Text>
					);
				}

				const newFileMatch = line.match(/^\+\+\+ (b\/)?(.+)$/);
				if (newFileMatch) {
					return (
						<Text key={idx}>
							<Text color="yellow">+++ {newFileMatch[1] ?? ""}</Text>
							<Text color="yellow" bold>
								{newFileMatch[2]}
							</Text>
						</Text>
					);
				}

				if (/^.+\s+\|\s+\d+\s+[+-]+$/.test(line)) {
					const match = line.match(/^(.+?)(\s+\|\s+\d+\s+[+-]+)$/);
					if (match) {
						const filePart = match[1]!;
						const statPart = match[2]!;
						const renameMatch = filePart.match(/^(.+?)\s+=>/);
						if (renameMatch) {
							return (
								<Text key={idx}>
									<Text color="white">{renameMatch[1]}</Text>
									<Text color="yellow"> =&gt; </Text>
									<Text color="white">{filePart.slice(renameMatch[0].length)}</Text>
									<Text color="gray">{statPart}</Text>
								</Text>
							);
						}
						return (
							<Text key={idx}>
								<Text color="white">{filePart}</Text>
								<Text color="gray">{statPart}</Text>
							</Text>
						);
					}
				}

				const statusMatch = line.match(/^\s+((?:modified|new file|deleted|renamed):)/);
				if (statusMatch) {
					const matchPos = line.indexOf(statusMatch[1]!);
					return (
						<Text key={matchPos}>
							<Text color="yellow">{statusMatch[1]}</Text>
							<Text color="white">{line.slice((matchPos === -1 ? 0 : matchPos) + (statusMatch[1]?.length ?? 0))}</Text>
						</Text>
					);
				}

				if (/^\s+/.test(line) && !/^(modified|new file|deleted|renamed)/.test(line.trim())) {
					const trimmed = line.trim();
					if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("(") && !trimmed.startsWith("...")) {
						const indent = line.match(/^\s+/)?.[0] ?? "";
						return (
							<Text key={idx}>
								<Text color="gray">{indent}</Text>
								<Text color="white">{trimmed}</Text>
							</Text>
						);
					}
				}

				return (
					<Text key={idx} color={color} bold={bold}>
						{line}
					</Text>
				);
			}),
		[lines]
	);

	return <Box flexDirection="column">{lineElements}</Box>;
});
