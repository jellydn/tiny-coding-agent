import React, { useState, useCallback } from "react";
import { Box, render } from "ink";
import { shouldUseInk } from "./utils.js";
import { StatusLineProvider, useStatusLine } from "./contexts/StatusLineContext.js";
import { StatusLine } from "./components/StatusLine.js";
import { ChatProvider, useChatContext } from "./contexts/ChatContext.js";
import { ChatLayout } from "./components/ChatLayout.js";
import type { Command } from "./components/CommandMenu.js";

interface StatusLineWrapperProps {
  children?: React.ReactNode;
}

function StatusLineWrapper({ children }: StatusLineWrapperProps): React.ReactElement {
  const context = useStatusLine();
  const showStatusLine =
    context.showStatusLine &&
    shouldUseInk() &&
    (context.status !== undefined ||
      context.model !== undefined ||
      context.tokensUsed !== undefined ||
      context.tool !== undefined);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexGrow={1}>{children}</Box>
      {showStatusLine && <StatusLine {...context} />}
    </Box>
  );
}

export function ChatApp(): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const { messages, addMessage, isThinking, currentModel, setCurrentModel } = useChatContext();

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  const handleInputSubmit = useCallback(
    (value: string) => {
      if (value.trim() && !isThinking) {
        addMessage("user", value.trim());
        setInputValue("");
      }
    },
    [addMessage, isThinking],
  );

  const handleCommandSelect = useCallback(
    (command: Command) => {
      if (command.name === "/model") {
        setShowModelPicker(true);
      } else {
        addMessage("assistant", `Selected command: ${command.name}`);
      }
    },
    [addMessage],
  );

  const handleModelSelect = useCallback(
    (modelId: string) => {
      if (modelId && modelId !== currentModel) {
        setCurrentModel(modelId);
        addMessage("assistant", `Model changed to: ${modelId}`);
      }
      setShowModelPicker(false);
    },
    [addMessage, currentModel, setCurrentModel],
  );

  return (
    <ChatLayout
      messages={messages}
      currentModel={currentModel}
      inputValue={inputValue}
      onInputChange={handleInputChange}
      onInputSubmit={handleInputSubmit}
      onCommandSelect={handleCommandSelect}
      onModelSelect={handleModelSelect}
      inputDisabled={isThinking}
      showModelPicker={showModelPicker}
    />
  );
}

interface AppProps {
  children?: React.ReactNode;
}

export function App({ children }: AppProps): React.ReactElement {
  return (
    <StatusLineProvider>
      <StatusLineWrapper>
        <ChatProvider>{children ?? <ChatApp />}</ChatProvider>
      </StatusLineWrapper>
    </StatusLineProvider>
  );
}

export function renderApp(element: React.ReactElement) {
  return render(element);
}
