import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { detectProvider } from "../../providers/model-registry.js";
import { getCachedOllamaModels } from "../../providers/ollama-models.js";

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama (Local)",
  ollamaCloud: "Ollama (Cloud)",
  openrouter: "OpenRouter",
  opencode: "OpenCode",
  zai: "Zai (Zhipu AI)",
};

export interface ModelPickerItem {
  id: string;
  name: string;
  description: string;
  source?: "ollama-local" | "config";
}

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

function buildVisibleItems(
  groupedModels: Map<string, ModelPickerItem[]>,
  expandedProviders: Set<string>,
): ListItem[] {
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

export function ModelPicker({
  models,
  currentModel,
  onSelect,
  onClose,
}: ModelPickerProps): React.ReactElement {
  const groupedModels = groupModelsByProvider(models);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isInitializing = useRef(true);

  const visibleItems = buildVisibleItems(groupedModels, expandedProviders);

  useEffect(() => {
    // Only auto-select the current model on first render (initialization)
    // After that, let the user navigate freely
    if (isInitializing.current) {
      const modelIndex = visibleItems.findIndex(
        (item) => item.type === "model" && item.model.id === currentModel,
      );
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

export interface ProviderModels {
  openai: ModelPickerItem[];
  anthropic: ModelPickerItem[];
  ollama: ModelPickerItem[];
  ollamaCloud: ModelPickerItem[];
  openrouter: ModelPickerItem[];
  opencode: ModelPickerItem[];
  zai: ModelPickerItem[];
}

const PROVIDER_MODELS: ProviderModels = {
  anthropic: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      description: "Anthropic's balanced",
    },
    { id: "claude-opus-4", name: "Claude Opus 4", description: "Anthropic's most powerful" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o", description: "OpenAI's flagship" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "OpenAI's efficient" },
    { id: "o1", name: "o1 (reasoning)", description: "OpenAI's reasoning" },
  ],
  ollama: [
    { id: "gpt-oss:20b", name: "GPT-OSS 20B", description: "Local coding model" },
    { id: "qwen3-coder", name: "Qwen3 Coder", description: "Local coding model" },
  ],
  ollamaCloud: [
    { id: "gpt-oss:120b-cloud", name: "GPT-OSS 120B", description: "Cloud model" },
    { id: "gpt-oss:20b-cloud", name: "GPT-OSS 20B", description: "Cloud model" },
    { id: "glm-4.6:cloud", name: "GLM 4.6", description: "Cloud model" },
    { id: "minimax-m2:cloud", name: "MiniMax M2", description: "Cloud model" },
    { id: "qwen3-coder:480b-cloud", name: "Qwen3 Coder 480B", description: "Cloud model" },
    { id: "deepseek-v3.1:671b-cloud", name: "DeepSeek V3.1 671B", description: "Cloud model" },
  ],
  openrouter: [
    { id: "openrouter/openai/gpt-4o", name: "GPT-4o (OpenRouter)", description: "OpenAI via OR" },
    {
      id: "openrouter/anthropic/claude-sonnet-4-20250514",
      name: "Claude Sonnet (OpenRouter)",
      description: "Anthropic via OR",
    },
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat", description: "DeepSeek's V3" },
  ],
  opencode: [
    { id: "opencode/big-pickle", name: "Big Pickle (Free)", description: "OpenCode free" },
    { id: "opencode/claude-3-5-haiku", name: "Claude 3.5 Haiku", description: "Anthropic compact" },
    { id: "opencode/claude-haiku-4-5", name: "Claude Haiku 4.5", description: "Anthropic compact" },
    { id: "opencode/claude-opus-4-1", name: "Claude Opus 4.1", description: "Anthropic" },
    { id: "opencode/claude-opus-4-5", name: "Claude Opus 4.5", description: "Anthropic flagship" },
    { id: "opencode/claude-sonnet-4", name: "Claude Sonnet 4", description: "Anthropic" },
    { id: "opencode/claude-sonnet-4-5", name: "Claude Sonnet 4.5", description: "Anthropic" },
    { id: "opencode/gemini-3-flash", name: "Gemini 3 Flash", description: "Google fast" },
    { id: "opencode/gemini-3-pro", name: "Gemini 3 Pro", description: "Google" },
    { id: "opencode/glm-4.6", name: "GLM 4.6", description: "Zhipu" },
    { id: "opencode/glm-4.7", name: "GLM 4.7", description: "Zhipu" },
    { id: "opencode/gpt-5", name: "GPT-5", description: "OpenAI" },
    { id: "opencode/gpt-5-codex", name: "GPT-5 Codex", description: "OpenAI coding" },
    { id: "opencode/gpt-5-nano", name: "GPT-5 Nano", description: "OpenAI compact" },
    { id: "opencode/gpt-5.1", name: "GPT-5.1", description: "OpenAI" },
    { id: "opencode/gpt-5.1-codex", name: "GPT-5.1 Codex", description: "OpenAI coding" },
    { id: "opencode/gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", description: "OpenAI coding" },
    { id: "opencode/gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", description: "OpenAI coding" },
    { id: "opencode/gpt-5.2", name: "GPT-5.2", description: "OpenAI latest" },
    { id: "opencode/gpt-5.2-codex", name: "GPT-5.2 Codex", description: "OpenAI coding" },
    { id: "opencode/kimi-k2", name: "Kimi K2", description: "Moonshot AI" },
    { id: "opencode/kimi-k2-thinking", name: "Kimi K2 Thinking", description: "Moonshot AI" },
    { id: "opencode/qwen3-coder", name: "Qwen3 Coder", description: "Alibaba coding" },
  ],
  zai: [
    { id: "glm-4.7", name: "GLM-4.7", description: "Zhipu's flagship coding model" },
    { id: "glm-4-plus", name: "GLM-4 Plus", description: "Enhanced GLM-4" },
    { id: "glm-4.6v", name: "GLM-4.6V", description: "Zhipu's multimodal vision model" },
    { id: "glm-4v", name: "GLM-4V", description: "Zhipu's vision model" },
    { id: "glm-4-air", name: "GLM-4 Air", description: "Lightweight efficient model" },
    { id: "glm-4-flash", name: "GLM-4 Flash", description: "Fast response model" },
    { id: "glm-4", name: "GLM-4", description: "Zhipu's powerful model" },
    { id: "glm-3-turbo", name: "GLM-3 Turbo", description: "Zhipu's efficient model" },
  ],
};

export interface EnabledProviders {
  openai?: boolean;
  anthropic?: boolean;
  ollama?: boolean;
  ollamaCloud?: boolean;
  openrouter?: boolean;
  opencode?: boolean;
  zai?: boolean;
}

export function getModelsForProviders(enabledProviders: EnabledProviders): ModelPickerItem[] {
  const seen = new Set<string>();
  const models: ModelPickerItem[] = [];

  function addModel(model: ModelPickerItem): void {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  }

  for (const [provider, enabled] of Object.entries(enabledProviders)) {
    if (!enabled) continue;

    if (provider === "ollama") {
      const localModels = getCachedOllamaModels();
      // Filter out :cloud and -cloud suffix models from local Ollama - they belong to ollamaCloud provider
      const localOnlyModels = localModels.filter(
        (m) => !m.id.endsWith(":cloud") && !m.id.endsWith("-cloud"),
      );
      const modelsToAdd = localOnlyModels.length > 0 ? localOnlyModels : PROVIDER_MODELS.ollama;
      for (const model of modelsToAdd) {
        addModel(model);
      }
    } else if (provider in PROVIDER_MODELS) {
      for (const model of PROVIDER_MODELS[provider as keyof ProviderModels]) {
        addModel(model);
      }
    }
  }

  return models;
}

export const DEFAULT_MODELS: ModelPickerItem[] = [...PROVIDER_MODELS.ollama];
