import { describe, expect, it } from "bun:test";
import { type EnabledProviders, getModelsForProviders } from "../../src/ui/components/ModelPicker.js";

describe("getModelsForProviders", () => {
	it("should return models for all 9 enabled providers", () => {
		const allProviders: EnabledProviders = {
			openai: true,
			anthropic: true,
			ollama: true,
			ollamaCloud: true,
			openrouter: true,
			opencode: true,
			zai: true,
			qwencloud: true,
			clinepass: true,
		};

		const models = getModelsForProviders(allProviders);

		// Should include at least one model from each provider
		const ids = models.map((m) => m.id);
		expect(ids.some((id) => id.startsWith("gpt-4o"))).toBe(true); // openai
		expect(ids.some((id) => id.startsWith("claude"))).toBe(true); // anthropic
		expect(ids.some((id) => id.startsWith("gpt-oss"))).toBe(true); // ollama / ollamaCloud
		expect(ids.some((id) => id.startsWith("openrouter/"))).toBe(true); // openrouter
		expect(ids.some((id) => id.startsWith("opencode/"))).toBe(true); // opencode
		expect(ids.some((id) => id.startsWith("glm-"))).toBe(true); // zai
		expect(ids.some((id) => id.startsWith("qw/"))).toBe(true); // qwencloud
		expect(ids.some((id) => id.startsWith("cline-pass/"))).toBe(true); // clinepass
	});

	it("should include QwenCloud models with qw/ prefix", () => {
		const models = getModelsForProviders({ qwencloud: true });
		const ids = models.map((m) => m.id);

		expect(ids).toContain("qw/glm-5.2");
		expect(ids).toContain("qw/qwen3.8-max-preview");
		expect(ids).toContain("qw/qwen3.7-plus");
		expect(ids).toContain("qw/qwen3.7-max");
		expect(ids).toContain("qw/qwen3.6-flash");
		expect(ids).toContain("qw/deepseek-v4-pro");
	});

	it("should include ClinePass models", () => {
		const models = getModelsForProviders({ clinepass: true });
		const ids = models.map((m) => m.id);

		expect(ids).toContain("cline-pass/glm-5.2");
	});

	it("should return empty array when no providers enabled", () => {
		const models = getModelsForProviders({});
		expect(models).toHaveLength(0);
	});

	it("should return empty array when all providers disabled", () => {
		const models = getModelsForProviders({
			openai: false,
			anthropic: false,
			ollama: false,
			ollamaCloud: false,
			openrouter: false,
			opencode: false,
			zai: false,
			qwencloud: false,
			clinepass: false,
		});
		expect(models).toHaveLength(0);
	});

	it("should deduplicate models across providers", () => {
		// Both ollama and ollamaCloud may have overlapping model names
		const models = getModelsForProviders({ ollama: true, ollamaCloud: true });
		const ids = models.map((m) => m.id);
		const uniqueIds = new Set(ids);

		expect(ids.length).toBe(uniqueIds.size);
	});
});
