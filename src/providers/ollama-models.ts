import { execSync } from "node:child_process";
import type { ModelPickerItem } from "../ui/components/ModelPicker.js";

export interface OllamaModel {
	name: string;
	size: string;
}

export function getLocalOllamaModels(): OllamaModel[] {
	try {
		const output = execSync("ollama ls", {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const lines = output.trim().split("\n");
		if (lines.length <= 1) return [];

		const models: OllamaModel[] = [];
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;

			const parts = line.split(/\s+/);
			const name = parts[0];
			const size = parts[2] ?? "";

			if (name) {
				models.push({
					name: name.replace(/:latest$/, ""),
					size,
				});
			}
		}

		return models;
	} catch {
		return [];
	}
}

export function ollamaModelsToPickerItems(models: OllamaModel[]): ModelPickerItem[] {
	return models.map((m) => ({
		id: m.name,
		name: m.name,
		description: m.size ? `${m.size} local` : "local",
		source: "ollama-local",
	}));
}

let cachedModels: ModelPickerItem[] | null = null;

export function getCachedOllamaModels(): ModelPickerItem[] {
	if (cachedModels === null) {
		const models = ollamaModelsToPickerItems(getLocalOllamaModels());
		// Don't cache empty results - allows retry on next call
		if (models.length > 0) {
			cachedModels = models;
		}
		return models;
	}
	return cachedModels;
}

export function refreshOllamaModelsCache(): void {
	cachedModels = null;
}
