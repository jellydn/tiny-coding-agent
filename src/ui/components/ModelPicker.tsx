import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { detectProvider } from "../../providers/model-registry.js";

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

  const filteredModels = models;

  useEffect(() => {
    const currentIndex = filteredModels.findIndex((m) => m.id === currentModel);
    if (currentIndex >= 0) {
      setSelectedIndex(currentIndex);
    }
  }, [currentModel, filteredModels]);

  useInput(
    (input, key) => {
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, filteredModels.length - 1));
      } else if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (key.return) {
        const selectedModel = filteredModels[selectedIndex];
        if (selectedModel) {
          onSelect(selectedModel.id);
        }
      } else if (key.escape) {
        onClose();
      }
    },
    { isActive: true },
  );

  if (filteredModels.length === 0) {
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
      {filteredModels.map((model, index) => {
        const isSelected = index === selectedIndex;
        const isActive = model.id === currentModel;
        let provider: string;
        try {
          provider = detectProvider(model.id);
        } catch {
          provider = "unknown";
        }

        return (
          <Box key={model.id}>
            <Text>
              {isSelected ? (
                <Text inverse color="blue">
                  {" "}
                  ▼{" "}
                </Text>
              ) : (
                <Text> </Text>
              )}
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

export const DEFAULT_MODELS: ModelPickerItem[] = [
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    description: "Anthropic's latest balanced model",
  },
  {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    description: "Anthropic's most powerful model",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    description: "OpenAI's flagship model",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    description: "OpenAI's efficient model",
  },
  {
    id: "o1",
    name: "o1 (reasoning)",
    description: "OpenAI's reasoning model",
  },
  {
    id: "ollama/llama3.2",
    name: "Llama 3.2",
    description: "Meta's open model via Ollama",
  },
  {
    id: "ollama/qwen2.5-coder",
    name: "Qwen 2.5 Coder",
    description: "Alibaba's coding model via Ollama",
  },
  {
    id: "openrouter/openai/gpt-4o",
    name: "GPT-4o (OpenRouter)",
    description: "OpenAI via OpenRouter",
  },
  {
    id: "openrouter/anthropic/claude-sonnet-4-20250514",
    name: "Claude Sonnet (OpenRouter)",
    description: "Anthropic via OpenRouter",
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    description: "DeepSeek's V3 model via OpenRouter",
  },
];
