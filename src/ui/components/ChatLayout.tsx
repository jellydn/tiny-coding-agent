import type React from "react";
import { Box, Text } from "ink";
import { Header } from "./Header.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { StatusLine } from "./StatusLine.js";
import { TextInput } from "./TextInput.js";
import { CommandMenu, type Command } from "./CommandMenu.js";
import { ModelPicker, DEFAULT_MODELS } from "./ModelPicker.js";
import { ThinkingIndicator } from "./ThinkingIndicator.js";
import { useStatusLine } from "../contexts/StatusLineContext.js";

interface ChatLayoutProps {
  messages: ChatMessage[];
  currentModel?: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputSubmit: (value: string) => void;
  onCommandSelect?: (command: Command) => void;
  onModelSelect?: (modelId: string) => void;
  inputPlaceholder?: string;
  inputDisabled?: boolean;
  showModelPicker?: boolean;
  isThinking?: boolean;
}

function WelcomeMessage(): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold color="cyan">
        {`
░▀▀█▀▀░░▀░░█▀▀▄░█░░█░░░█▀▀▄░█▀▀▀░█▀▀░█▀▀▄░▀█▀
░░▒█░░░░█▀░█░▒█░█▄▄█░░▒█▄▄█░█░▀▄░█▀▀░█░▒█░░█░
░░▒█░░░▀▀▀░▀░░▀░▄▄▄▀░░▒█░▒█░▀▀▀▀░▀▀▀░▀░░▀░░▀░

`}
      </Text>
      <Text dimColor>by ITMan.fyi</Text>
      <Text>Type a message or / for commands</Text>
      <Text>/model - Switch model /clear - Clear /exit - Exit</Text>
    </Box>
  );
}

export function ChatLayout({
  messages,
  currentModel,
  inputValue,
  onInputChange,
  onInputSubmit,
  onCommandSelect,
  onModelSelect,
  inputPlaceholder,
  inputDisabled,
  showModelPicker = false,
  isThinking = false,
}: ChatLayoutProps): React.ReactElement {
  const statusContext = useStatusLine();
  const showCommandMenu = !inputDisabled && inputValue.startsWith("/");
  const commandFilter = showCommandMenu ? inputValue.slice(1) : "";

  const handleCommandSelect = (command: Command) => {
    if (onCommandSelect) {
      onCommandSelect(command);
    }
    onInputChange("");
  };

  const handleModelSelect = (modelId: string) => {
    if (onModelSelect) {
      onModelSelect(modelId);
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <Header model={currentModel} />

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {messages.length === 0 ? <WelcomeMessage /> : <MessageList messages={messages} />}
        {isThinking && messages.length > 0 && (
          <Box marginTop={1}>
            <ThinkingIndicator visible={true} />
          </Box>
        )}
      </Box>

      <Box flexShrink={0} borderStyle="single" borderColor="gray" paddingX={1}>
        <StatusLine
          status={statusContext.status}
          model={statusContext.model}
          tokensUsed={statusContext.tokensUsed}
          tokensMax={statusContext.tokensMax}
          tool={statusContext.tool}
          toolStartTime={statusContext.toolStartTime}
        />
      </Box>

      <Box flexShrink={0}>
        {showCommandMenu && (
          <CommandMenu
            filter={commandFilter}
            onSelect={handleCommandSelect}
            onClose={() => onInputChange("")}
          />
        )}
        {showModelPicker && (
          <ModelPicker
            models={DEFAULT_MODELS}
            currentModel={currentModel ?? ""}
            onSelect={handleModelSelect}
            onClose={() => onModelSelect?.("")}
          />
        )}
        {!showCommandMenu && !showModelPicker && (
          <TextInput
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onInputSubmit}
            placeholder={inputPlaceholder}
            disabled={inputDisabled}
          />
        )}
      </Box>
    </Box>
  );
}
