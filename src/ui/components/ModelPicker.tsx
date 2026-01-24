import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { detectProvider } from "../../providers/model-registry.js";
import { getCachedOllamaModels } from "../../providers/ollama-models.js";

function getProviderSafely(model: string): string {
  try {
    return detectProvider(model);
  } catch {
    return "unknown";
  }
}

export interface ModelPickerItem {
  id: string;
  name: string;
  description: string;
}

interface ModelPickerProps {
  models: ModelPickerItem[];
  currentModel: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}

export function ModelPicker({
  models,
  currentModel,
  onSelect,
  onClose,
}: ModelPickerProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const currentIndex = models.findIndex((m) => m.id === currentModel);
    if (currentIndex >= 0) {
      setSelectedIndex(currentIndex);
    }
  }, [currentModel, models]);

  useInput(
    (input, key) => {
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, models.length - 1));
      } else if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (key.return) {
        const selectedModel = models[selectedIndex];
        if (selectedModel) {
          onSelect(selectedModel.id);
        }
      } else if (key.escape) {
        onClose();
      }
    },
    { isActive: true },
  );

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
          Select Model
        </Text>
      </Box>
      {models.map((model, index) => {
        const isSelected = index === selectedIndex;
        const isActive = model.id === currentModel;
        const provider = getProviderSafely(model.id);

        return (
          <Box key={`${index}-${model.id}`}>
            <Text inverse={isSelected} color={isSelected ? "blue" : undefined}>
              {isSelected ? " ▼ " : "   "}
            </Text>
            <Text bold color={isSelected ? "blue" : undefined}>
              {model.name}
            </Text>
            <Text color="gray"> </Text>
            <Text color="gray" dimColor>
              {provider}
            </Text>
            <Text> </Text>
            {isActive && <Text color="green">[active]</Text>}
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
};

export interface EnabledProviders {
  openai?: boolean;
  anthropic?: boolean;
  ollama?: boolean;
  ollamaCloud?: boolean;
  openrouter?: boolean;
  opencode?: boolean;
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
      const modelsToAdd = localModels.length > 0 ? localModels : PROVIDER_MODELS.ollama;
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
