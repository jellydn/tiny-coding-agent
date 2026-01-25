import { Box, Text } from "ink";
import type React from "react";
import { parseModelString } from "../../providers/factory.js";
import { detectProvider } from "../../providers/model-registry.js";
import { getCachedOllamaModels } from "../../providers/ollama-models.js";
import { useStatusLine } from "../contexts/StatusLineContext.js";

interface HeaderProps {
	model?: string;
	skillCount?: number;
}

export function Header({ model, skillCount }: HeaderProps): React.ReactElement {
	const statusContext = useStatusLine();
	let providerDisplay = "";
	let modelDisplay = model ?? "";

	if (model) {
		try {
			// Parse model@provider format first
			const { model: modelName, provider: explicitProvider } = parseModelString(model);

			// Use explicit provider if specified, otherwise detect
			let providerType = explicitProvider;

			if (!providerType) {
				// Check if model exists in local Ollama before using pattern detection
				const localOllamaModels = getCachedOllamaModels();
				const isLocalOllamaModel = localOllamaModels.some((m) => m.id === modelName);

				if (isLocalOllamaModel) {
					providerType = "ollama";
				} else {
					providerType = detectProvider(modelName);
				}
			}

			providerDisplay = providerType;
			modelDisplay = modelName;
		} catch {
			providerDisplay = "unknown";
			modelDisplay = model;
		}
	}

	const mcpCount = statusContext.mcpServerCount;
	const showMcp = mcpCount !== undefined && mcpCount > 0;

	return (
		<Box
			flexDirection="row"
			justifyContent="space-between"
			borderStyle="round"
			borderColor="cyan"
			paddingX={1}
			width="100%"
		>
			<Box flexDirection="row" gap={1}>
				<Text bold color="cyan">
					🤖 tiny-agent
				</Text>
				{showMcp && <Text color="gray">[MCP: {mcpCount}]</Text>}
				{skillCount !== undefined && skillCount > 0 && (
					<Text color="gray">
						[{skillCount} skill{skillCount !== 1 ? "s" : ""}]
					</Text>
				)}
			</Box>
			{model ? (
				<Text>
					<Text color="gray">{providerDisplay}: </Text>
					<Text color="green">{modelDisplay}</Text>
				</Text>
			) : (
				<Text color="gray">No model selected</Text>
			)}
		</Box>
	);
}
