import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { detectProvider } from "../../providers/model-registry.js";
import { PROVIDER_NAMES } from "../model-data.js";

export type {
	EnabledProviders,
	ModelPickerItem,
	ProviderModels,
} from "../model-data.js";
export {
	DEFAULT_MODELS,
	getEnabledProviders,
	getModelsForProviders,
	getProviderDisplayName,
} from "../model-data.js";

interface ModelPickerProps {
	models: ModelPickerItem[];
	currentModel: string;
	onSelect: (model: string) => void;
	onClose: () => void;
}

type ListItem = { type: "provider"; provider: string } | { type: "model"; model: ModelPickerItem };

function groupModelsByProvider(models: ModelPickerItem[]): Map<string, ModelPickerItem[]> {
	const grouped = new Map<string, ModelPickerItem[]>();
	for (const model of models) {
		let provider: string;

		// Models with :cloud or -cloud suffix go to ollamaCloud provider
		if (model.id.endsWith(":cloud") || model.id.endsWith("-cloud")) {
			provider = "ollamaCloud";
		}
		// Local Ollama models always go to ollama provider, regardless of name pattern
		// This prevents GLM models installed in Ollama from being classified as zai
		else if (model.source === "ollama-local") {
			provider = "ollama";
		} else {
			// Config models are detected by their name pattern
			try {
				provider = detectProvider(model.id);
			} catch {
				provider = "unknown";
			}
		}

		if (!grouped.has(provider)) {
			grouped.set(provider, []);
		}
		grouped.get(provider)?.push(model);
	}
	return grouped;
}

function buildVisibleItems(groupedModels: Map<string, ModelPickerItem[]>, expandedProviders: Set<string>): ListItem[] {
	const items: ListItem[] = [];
	for (const [provider, models] of groupedModels) {
		items.push({ type: "provider", provider });
		if (expandedProviders.has(provider)) {
			for (const model of models) {
				items.push({ type: "model", model });
			}
		}
	}
	return items;
}

export function ModelPicker({ models, currentModel, onSelect, onClose }: ModelPickerProps): React.ReactElement {
	const groupedModels = groupModelsByProvider(models);
	const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
	const [selectedIndex, setSelectedIndex] = useState(0);
	const isInitializing = useRef(true);

	const visibleItems = buildVisibleItems(groupedModels, expandedProviders);

	useEffect(() => {
		// Only auto-select the current model on first render (initialization)
		// After that, let the user navigate freely
		if (isInitializing.current) {
			const modelIndex = visibleItems.findIndex((item) => item.type === "model" && item.model.id === currentModel);
			if (modelIndex >= 0) {
				setSelectedIndex(modelIndex);
			}
			isInitializing.current = false;
		}
	}, [currentModel, visibleItems]);

	useInput((_input, key) => {
		if (key.downArrow) {
			setSelectedIndex((prev) => {
				const maxIndex = visibleItems.length - 1;
				return Math.min(prev + 1, maxIndex);
			});
		} else if (key.upArrow) {
			setSelectedIndex((prev) => Math.max(prev - 1, 0));
		} else if (key.return) {
			// Use a functional update to ensure we get the latest selectedIndex
			setSelectedIndex((currentIndex) => {
				const selectedItem = visibleItems[currentIndex];
				if (!selectedItem) return currentIndex;

				if (selectedItem.type === "provider") {
					setExpandedProviders((prev) => {
						const next = new Set(prev);
						if (next.has(selectedItem.provider)) {
							next.delete(selectedItem.provider);
						} else {
							next.add(selectedItem.provider);
						}
						return next;
					});
				} else if (selectedItem.type === "model") {
					onSelect(selectedItem.model.id);
				}
				return currentIndex;
			});
		} else if (key.escape) {
			onClose();
		}
	});

	if (models.length === 0) {
		return (
			<Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
				<Text color="gray">No models available</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
			<Box marginBottom={1}>
				<Text bold color="gray">
					Select Model (Enter to expand provider)
				</Text>
			</Box>
			{visibleItems.map((item, index) => {
				const isSelected = index === selectedIndex;

				if (item.type === "provider") {
					const isExpanded = expandedProviders.has(item.provider);
					const providerName = PROVIDER_NAMES[item.provider] ?? item.provider;
					const modelsInProvider = groupedModels.get(item.provider)?.length ?? 0;

					return (
						<Box key={`provider-${item.provider}`}>
							<Text inverse={isSelected} color={isSelected ? "blue" : undefined}>
								{isSelected ? " ▼ " : "   "}
							</Text>
							<Text bold color={isSelected ? "blue" : "yellow"}>
								{isExpanded ? "▼ " : "▶ "}
							</Text>
							<Text bold color={isSelected ? "blue" : undefined}>
								{providerName}
							</Text>
							<Text color="gray" dimColor>
								{" "}
								({modelsInProvider} models)
							</Text>
						</Box>
					);
				}

				const isActive = item.model.id === currentModel;
				return (
					<Box key={`model-${item.model.id}`} paddingLeft={2}>
						<Text inverse={isSelected} color={isSelected ? "blue" : undefined}>
							{isSelected ? " ▼ " : "   "}
						</Text>
						<Text bold color={isSelected ? "blue" : undefined}>
							{item.model.name}
						</Text>
						<Text color="gray" dimColor>
							{" - "}
							{item.model.description}
						</Text>
						{isActive && <Text color="green"> [active]</Text>}
					</Box>
				);
			})}
		</Box>
	);
}
