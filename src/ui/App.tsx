import React, { useState, useCallback } from "react";
import { Box, render } from "ink";
import { shouldUseInk } from "./utils.js";
import { StatusLineProvider, useStatusLine } from "./contexts/StatusLineContext.js";
import { StatusLine } from "./components/StatusLine.js";
import { ChatProvider, useChatContext } from "./contexts/ChatContext.js";
import { ChatLayout } from "./components/ChatLayout.js";
import type { Command } from "./components/CommandMenu.js";
import type { Agent } from "@/core/index.js";

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

interface ChatAppProps {
  agent?: Agent;
}

export function ChatApp({ agent }: ChatAppProps): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const {
    messages,
    addMessage,
    isThinking,
    setThinking,
    currentModel,
    setCurrentModel,
    setStreamingText,
  } = useChatContext();

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  const handleInputSubmit = useCallback(
    async (value: string) => {
      if (value.trim() && !isThinking && agent) {
        const userMessage = value.trim();
        addMessage("user", userMessage);
        setInputValue("");
        setThinking(true);
        setStreamingText("");

        let accumulatedContent = "";
        try {
          for await (const chunk of agent.runStream(userMessage, currentModel)) {
            if (chunk.content) {
              accumulatedContent += chunk.content;
              setStreamingText(accumulatedContent);
            }
            if (chunk.done) {
              if (accumulatedContent.trim()) {
                addMessage("assistant", accumulatedContent);
              }
              setStreamingText("");
            }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          addMessage("assistant", `Error: ${errorMessage}`);
          setStreamingText("");
        } finally {
          setThinking(false);
        }
      }
    },
    [addMessage, agent, isThinking, currentModel, setThinking, setStreamingText],
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
  initialModel?: string;
  agent?: Agent;
}

export function App({ children, initialModel, agent }: AppProps): React.ReactElement {
  return (
    <StatusLineProvider>
      <StatusLineWrapper>
        <ChatProvider initialModel={initialModel}>
          {children ?? <ChatApp agent={agent} />}
        </ChatProvider>
      </StatusLineWrapper>
    </StatusLineProvider>
  );
}

export function renderApp(element: React.ReactElement) {
  return render(element);
}
