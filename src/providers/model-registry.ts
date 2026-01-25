export type ProviderType = "openai" | "anthropic" | "ollama" | "ollamaCloud" | "openrouter" | "opencode" | "zai";

export interface ModelEntry {
	provider: ProviderType;
	supportsThinking: boolean;
	supportsTools: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	patterns: string[];
}

const MODEL_DATABASE: ModelEntry[] = [
	{
		provider: "ollamaCloud",
		patterns: ["-cloud$", ":cloud$"],
		supportsThinking: false,
		supportsTools: true,
	},
	{
		provider: "ollama",
		patterns: ["-oss", "^qwen3-coder", "^gpt-oss"],
		supportsThinking: false,
		supportsTools: true,
	},
	{
		provider: "anthropic",
		patterns: ["^claude-3-5", "^claude-4", "^claude-3-opus", "^claude-3-sonnet", "^claude-3-haiku"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 200000,
		maxOutputTokens: 8192,
	},
	{
		provider: "anthropic",
		patterns: ["^claude"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 200000,
		maxOutputTokens: 8192,
	},
	{
		provider: "openai",
		patterns: ["^o1", "^o3"],
		supportsThinking: true,
		supportsTools: false,
		contextWindow: 200000,
		maxOutputTokens: 100000,
	},
	{
		provider: "openai",
		patterns: ["^gpt-4o", "^gpt-4o-mini", "^gpt-4-turbo"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 128000,
		maxOutputTokens: 16384,
	},
	{
		provider: "openai",
		patterns: ["^gpt-3.5"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 16385,
		maxOutputTokens: 4096,
	},
	{
		provider: "openai",
		patterns: ["^(gpt(?!-oss)(?!-v))"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 128000,
		maxOutputTokens: 4096,
	},
	{
		provider: "openrouter",
		patterns: ["^openrouter/", "^anthropic/", "^google/", "^meta/", "^mistralai/", "^deepseek/"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 200000,
		maxOutputTokens: 8192,
	},
	{
		provider: "opencode",
		patterns: ["^opencode/", "^big-", "^qwen-"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 200000,
		maxOutputTokens: 8192,
	},
	{
		provider: "zai",
		patterns: ["^glm-", "^zhipu/"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 200000,
		maxOutputTokens: 8192,
	},
	{
		provider: "ollama",
		patterns: [".*"],
		supportsThinking: true,
		supportsTools: true,
		contextWindow: 16385,
		maxOutputTokens: 4096,
	},
];

const patternCache = new Map<string, RegExp>();

function compilePattern(pattern: string): RegExp {
	const existing = patternCache.get(pattern);
	if (existing) return existing;
	const compiled = new RegExp(pattern, "i");
	patternCache.set(pattern, compiled);
	return compiled;
}

export function detectProvider(model: string): ProviderType {
	const normalizedModel = model.trim().toLowerCase();

	for (const entry of MODEL_DATABASE) {
		for (const pattern of entry.patterns) {
			if (compilePattern(pattern).test(normalizedModel)) {
				return entry.provider;
			}
		}
	}

	throw new Error(`Unable to detect provider for model: ${model}`);
}

export function getModelInfo(model: string): ModelEntry | null {
	const normalizedModel = model.trim().toLowerCase();

	for (const entry of MODEL_DATABASE) {
		for (const pattern of entry.patterns) {
			if (compilePattern(pattern).test(normalizedModel)) {
				return entry;
			}
		}
	}

	return null;
}

export function supportsThinking(model: string): boolean {
	const info = getModelInfo(model);
	return info?.supportsThinking ?? false;
}

export function supportsTools(model: string): boolean {
	const info = getModelInfo(model);
	return info?.supportsTools ?? true;
}

export function getProviderPatterns(provider: ProviderType): string[] {
	const patterns: string[] = [];
	for (const entry of MODEL_DATABASE) {
		if (entry.provider === provider) {
			patterns.push(...entry.patterns);
		}
	}
	return patterns;
}

export function getModelContextWindow(model: string): number {
	const info = getModelInfo(model);
	if (info?.contextWindow) return info.contextWindow;
	const normalizedModel = model.trim().toLowerCase();
	if (normalizedModel.startsWith("o1") || normalizedModel.startsWith("o3")) return 200000;
	if (normalizedModel.startsWith("gpt-4o")) return 128000;
	if (normalizedModel.startsWith("gpt-3.5")) return 16385;
	if (normalizedModel.startsWith("claude")) return 200000;
	return 16385;
}

export function getModelMaxOutputTokens(model: string): number {
	const info = getModelInfo(model);
	if (info?.maxOutputTokens) return info.maxOutputTokens;
	const normalizedModel = model.trim().toLowerCase();
	if (normalizedModel.startsWith("o1") || normalizedModel.startsWith("o3")) return 100000;
	if (normalizedModel.startsWith("gpt-4o")) return 16384;
	if (normalizedModel.startsWith("claude")) return 8192;
	return 4096;
}
