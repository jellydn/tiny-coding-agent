/**
 * Model Registry - Centralized model-to-provider mapping
 *
 * This module provides a declarative database of model patterns with capability
 * metadata. It serves as the single source of truth for provider detection,
 * eliminating duplicate logic and making it easy to add support for new models.
 *
 * @see ADR-007: Model Registry Pattern for Provider Detection
 */

/**
 * Supported provider types
 */
export type ProviderType = "openai" | "anthropic" | "ollama" | "openrouter" | "opencode";

/**
 * Model entry in the registry database
 */
export interface ModelEntry {
  /** The provider that hosts this model */
  provider: ProviderType;
  /** Whether this model supports thinking/reasoning mode */
  supportsThinking: boolean;
  /** Whether this model supports function calling/tools */
  supportsTools: boolean;
  /** Regex patterns for matching model names (evaluated in order) */
  patterns: string[];
}

/**
 * Model database - ordered by specificity (more specific patterns first)
 *
 * IMPORTANT: Order matters! First matching pattern wins.
 * - Put more specific patterns before generic ones
 * - Gateway providers (openrouter, opencode) must come before ollama catch-all
 */
const MODEL_DATABASE: ModelEntry[] = [
  // ============================================================
  // Anthropic - Claude models
  // ============================================================
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

  // ============================================================
  // OpenAI - GPT and O-series models
  // ============================================================
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

  // ============================================================
  // Gateway providers - must come before catch-all
  // ============================================================
  {
    provider: "openrouter",
    patterns: ["^openrouter/", "^anthropic/", "^google/", "^meta/", "^mistralai/", "^deepseek/"],
    supportsThinking: false,
    supportsTools: true,
  },
  {
    provider: "opencode",
    patterns: ["^opencode/"],
    supportsThinking: false,
    supportsTools: true,
  },

  // ============================================================
  // Ollama - including Ollama Cloud (-oss suffix)
  // ============================================================
  {
    provider: "ollama",
    patterns: ["-oss$", "^ollama-cloud/"],
    supportsThinking: false,
    supportsTools: true,
  },

  // ============================================================
  // Ollama - catch-all for local/unknown models
  // ============================================================
  {
    provider: "ollama",
    patterns: [".*"],
    supportsThinking: false,
    supportsTools: true,
  },
];

/**
 * Cache for compiled regex patterns
 */
const patternCache = new Map<string, RegExp>();

/**
 * Compile a regex pattern and cache it
 */
function compilePattern(pattern: string): RegExp {
  if (!patternCache.has(pattern)) {
    patternCache.set(pattern, new RegExp(pattern, "i"));
  }
  return patternCache.get(pattern)!;
}

/**
 * Detect the provider for a given model name
 *
 * @param model - The model name to detect
 * @returns The provider type
 * @throws Error if no provider matches (should not happen due to catch-all)
 *
 * @example
 * detectProvider("claude-3-5-sonnet") // returns "anthropic"
 * detectProvider("gpt-4o") // returns "openai"
 * detectProvider("llama3.2") // returns "ollama"
 * detectProvider("openrouter/anthropic/claude-3.5-sonnet") // returns "openrouter"
 */
export function detectProvider(model: string): ProviderType {
  const normalizedModel = model.trim().toLowerCase();

  for (const entry of MODEL_DATABASE) {
    for (const pattern of entry.patterns) {
      const regex = compilePattern(pattern);
      if (regex.test(normalizedModel)) {
        return entry.provider;
      }
    }
  }

  // This should never happen due to the catch-all pattern
  throw new Error(`Unable to detect provider for model: ${model}`);
}

/**
 * Get model information from the registry
 *
 * @param model - The model name to look up
 * @returns Model entry or null if not found
 *
 * @example
 * getModelInfo("claude-3-5-sonnet")
 * // returns { provider: "anthropic", supportsThinking: true, supportsTools: true, patterns: [...] }
 */
export function getModelInfo(model: string): ModelEntry | null {
  const normalizedModel = model.trim().toLowerCase();

  for (const entry of MODEL_DATABASE) {
    for (const pattern of entry.patterns) {
      const regex = compilePattern(pattern);
      if (regex.test(normalizedModel)) {
        return { ...entry }; // Return a copy to prevent mutation
      }
    }
  }

  return null;
}

/**
 * Check if a model supports thinking mode
 *
 * @param model - The model name to check
 * @returns true if the model supports thinking mode
 */
export function supportsThinking(model: string): boolean {
  const info = getModelInfo(model);
  return info?.supportsThinking ?? false;
}

/**
 * Check if a model supports tools/function calling
 *
 * @param model - The model name to check
 * @returns true if the model supports tools
 */
export function supportsTools(model: string): boolean {
  const info = getModelInfo(model);
  return info?.supportsTools ?? true; // Default to true for unknown models
}

/**
 * Get all registered patterns for a provider
 *
 * @param provider - The provider type
 * @returns Array of regex patterns for the provider
 */
export function getProviderPatterns(provider: ProviderType): string[] {
  const patterns: string[] = [];
  for (const entry of MODEL_DATABASE) {
    if (entry.provider === provider) {
      patterns.push(...entry.patterns);
    }
  }
  return patterns;
}
