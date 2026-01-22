export type ProviderType = "openai" | "anthropic" | "ollama" | "ollamaCloud" | "openrouter" | "opencode";

export interface ModelEntry {
  provider: ProviderType;
  supportsThinking: boolean;
  supportsTools: boolean;
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
    patterns: ["^claude-3-5", "^claude-4"],
    supportsThinking: true,
    supportsTools: true,
  },
  {
    provider: "anthropic",
    patterns: ["^claude"],
    supportsThinking: false,
    supportsTools: true,
  },
  {
    provider: "openai",
    patterns: ["^o1", "^o3"],
    supportsThinking: true,
    supportsTools: false,
  },
  {
    provider: "openai",
    patterns: ["^gpt"],
    supportsThinking: false,
    supportsTools: true,
  },
  {
    provider: "openrouter",
    patterns: ["^openrouter/", "^anthropic/", "^google/", "^meta/", "^mistralai/", "^deepseek/"],
    supportsThinking: false,
    supportsTools: true,
  },
  {
    provider: "opencode",
    patterns: ["^opencode/", "^big-", "^qwen-"],
    supportsThinking: false,
    supportsTools: true,
  },
  {
    provider: "ollama",
    patterns: [".*"],
    supportsThinking: false,
    supportsTools: true,
  },
];

const patternCache = new Map<string, RegExp>();

function compilePattern(pattern: string): RegExp {
  if (!patternCache.has(pattern)) {
    patternCache.set(pattern, new RegExp(pattern, "i"));
  }
  return patternCache.get(pattern)!;
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
        return { ...entry };
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
