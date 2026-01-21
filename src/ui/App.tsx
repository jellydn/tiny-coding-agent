import React, { useState, useCallback } from "react";
import { Box, render } from "ink";
import { ChatProvider, useChatContext } from "./contexts/ChatContext.js";
import { StatusLineProvider } from "./contexts/StatusLineContext.js";
import { ChatLayout } from "./components/ChatLayout.js";

import type { Agent } from "@/core/agent.js";
import { useCommandHandler } from "./hooks/useCommandHandler.js";
import { MessageRole } from "./types/enums.js";

export function ChatApp(): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const {
    messages,
    addMessage,
    isThinking,
    currentModel,
    setCurrentModel,
    streamingText,
    sendMessage,
    clearMessages,
  } = useChatContext();

  const { handleCommandSelect, handleSlashCommand } = useCommandHandler({
    onAddMessage: addMessage,
    onClearMessages: clearMessages,
    onSetShowModelPicker: setShowModelPicker,
    onExit: () => process.exit(0),
  });

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  const handleInputSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isThinking) return;

      if (trimmed.startsWith("/")) {
        setInputValue("");
        handleSlashCommand(trimmed);
        return;
      }

      setInputValue("");
      await sendMessage(trimmed);
    },
    [isThinking, sendMessage, handleSlashCommand],
  );

  const handleModelSelect = useCallback(
    (modelId: string) => {
      if (modelId && modelId !== currentModel) {
        setCurrentModel(modelId);
        addMessage(MessageRole.ASSISTANT, `Model changed to: ${modelId}`);
      }
      setShowModelPicker(false);
    },
    [addMessage, currentModel, setCurrentModel],
  );

  const displayMessages = isThinking
    ? [
        ...messages,
        {
          id: `streaming-${Date.now()}`,
          role: MessageRole.ASSISTANT,
          content: streamingText || "...",
        },
      ]
    : messages;

  return (
    <Box flexDirection="column" height="100%">
      <ChatLayout
        messages={displayMessages}
        currentModel={currentModel}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onInputSubmit={handleInputSubmit}
        onCommandSelect={handleCommandSelect}
        onModelSelect={handleModelSelect}
        inputDisabled={isThinking}
        showModelPicker={showModelPicker}
        inputPlaceholder={
          isThinking ? "Waiting for response..." : "Type a message... (/ for commands)"
        }
        isThinking={isThinking}
      />
    </Box>
  );
}

interface AppProps {
  children?: React.ReactNode;
  initialModel?: string;
  agent?: Agent;
}

export function App({ children, initialModel, agent }: AppProps): React.ReactElement {
  return (
    <StatusLineProvider>
      <ChatProvider initialModel={initialModel} agent={agent}>
        {children ?? <ChatApp />}
      </ChatProvider>
    </StatusLineProvider>
  );
}

export function renderApp(element: React.ReactElement) {
  return render(element);
}
