import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, render, useInput } from "ink";
import { ChatProvider, useChatContext } from "./contexts/ChatContext.js";
import { StatusLineProvider } from "./contexts/StatusLineContext.js";
import { ChatLayout } from "./components/ChatLayout.js";
import type { EnabledProviders } from "./components/ModelPicker.js";

import type { Agent } from "@/core/agent.js";
import { useCommandHandler } from "./hooks/useCommandHandler.js";
import { MessageRole } from "./types/enums.js";
import { formatTimestamp } from "./utils.js";

export function ChatApp(): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [cancelCount, setCancelCount] = useState(0);
  const cancelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const {
    messages,
    addMessage,
    isThinking,
    setThinking,
    currentModel,
    setCurrentModel,
    streamingText,
    sendMessage,
    clearMessages,
    cancelActiveRequest,
    enabledProviders,
    agent,
  } = useChatContext();

  const { handleCommandSelect, handleSlashCommand } = useCommandHandler({
    onAddMessage: addMessage,
    onClearMessages: clearMessages,
    onSetShowModelPicker: setShowModelPicker,
    onExit: () => process.exit(0),
    agent: agent ?? undefined,
  });

  useEffect(() => {
    if (cancelCount === 2) {
      if (cancelTimeoutRef.current) {
        clearTimeout(cancelTimeoutRef.current);
        cancelTimeoutRef.current = null;
      }
      setCancelCount(0);
      if (isThinking) {
        cancelActiveRequest();
        addMessage(MessageRole.ASSISTANT, "\nCancelled. Type a new message or /exit to quit.");
      } else {
        setInputValue("");
        addMessage(MessageRole.ASSISTANT, "Cancelled.");
      }
    } else if (cancelCount === 1) {
      cancelTimeoutRef.current = setTimeout(() => {
        setCancelCount(0);
      }, 300);
    }
    return () => {
      if (cancelTimeoutRef.current) {
        clearTimeout(cancelTimeoutRef.current);
      }
    };
  }, [cancelCount, isThinking, setThinking, addMessage, cancelActiveRequest]);

  useInput(
    (input, key) => {
      if (key.escape) {
        setCancelCount((prev) => prev + 1);
      }
    },
    { isActive: isThinking },
  );

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
        addMessage(MessageRole.SEPARATOR, formatTimestamp());
        const displayName = modelId.replace(/^opencode\//, "");
        addMessage(MessageRole.ASSISTANT, `Model changed to: ${displayName}`);
      }
      setShowModelPicker(false);
    },
    [addMessage, currentModel, setCurrentModel],
  );

  const [skillItems, setSkillItems] = useState<
    Array<{ name: string; description: string; location: string }>
  >([]);

  useEffect(() => {
    if (!agent) return;
    const loadSkills = async () => {
      await agent.waitForSkills();
      const registry = agent.getSkillRegistry();
      setSkillItems(Array.from(registry.values()));
    };
    loadSkills();
  }, [agent]);

  const displayMessages = isThinking
    ? [
        ...messages,
        {
          id: "streaming",
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
          isThinking
            ? "Waiting for response... (ESC twice to cancel)"
            : "Type a message... (/ for commands)"
        }
        enabledProviders={enabledProviders}
        skillItems={skillItems}
      />
    </Box>
  );
}

interface AppProps {
  children?: React.ReactNode;
  initialModel?: string;
  agent?: Agent;
  enabledProviders?: EnabledProviders;
}

export function App({
  children,
  initialModel,
  agent,
  enabledProviders,
}: AppProps): React.ReactElement {
  return (
    <StatusLineProvider>
      <ChatProvider initialModel={initialModel} agent={agent} enabledProviders={enabledProviders}>
        {children ?? <ChatApp />}
      </ChatProvider>
    </StatusLineProvider>
  );
}

export function renderApp(element: React.ReactElement) {
  return render(element);
}
