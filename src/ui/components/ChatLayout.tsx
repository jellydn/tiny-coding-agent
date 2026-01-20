import React from "react";
import { Box } from "ink";
import { Header } from "./Header.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { ContextStatus } from "./ContextStatus.js";
import { TextInput } from "./TextInput.js";
import type { Command } from "./CommandMenu.js";

interface ChatLayoutProps {
  messages: ChatMessage[];
  currentModel?: string;
  tokensUsed?: number;
  tokensMax?: number;
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputSubmit: (value: string) => void;
  onCommandSelect?: (command: Command) => void;
  inputPlaceholder?: string;
  inputDisabled?: boolean;
}

export function ChatLayout({
  messages,
  currentModel,
  tokensUsed,
  tokensMax,
  inputValue,
  onInputChange,
  onInputSubmit,
  onCommandSelect,
  inputPlaceholder,
  inputDisabled,
}: ChatLayoutProps): React.ReactElement {
  return (
    <Box flexDirection="column" height="100%">
      <Box marginBottom={0}>
        <Header model={currentModel} />
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <MessageList messages={messages} />
      </Box>
      <Box marginTop={1}>
        <ContextStatus tokensUsed={tokensUsed} tokensMax={tokensMax} />
      </Box>
      <Box height={1} marginTop={0}>
        <TextInput
          value={inputValue}
          onChange={onInputChange}
          onSubmit={onInputSubmit}
          onCommandSelect={onCommandSelect}
          placeholder={inputPlaceholder}
          disabled={inputDisabled}
        />
      </Box>
    </Box>
  );
}
