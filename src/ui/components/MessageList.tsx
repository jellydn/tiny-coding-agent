import React, { memo, useMemo } from "react";
import { Box } from "ink";
import { Message } from "./Message.js";
import type { ChatMessage } from "../contexts/ChatContext.js";

export type { ChatMessage };

interface MessageListProps {
  messages: ChatMessage[];
}

export const MessageList = memo(function MessageList({
  messages,
}: MessageListProps): React.ReactElement {
  const visibleMessages = useMemo(() => messages.slice(-30), [messages]);
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const isStreaming = lastMessage?.id === "streaming";

  const otherMessages = useMemo(
    () => (isStreaming ? visibleMessages.slice(0, -1) : visibleMessages),
    [visibleMessages, isStreaming],
  );

  return (
    <Box flexDirection="column">
      {otherMessages.map((msg) => (
        <Message
          key={msg.id}
          role={msg.role}
          content={msg.content}
          toolName={msg.toolName}
          toolStatus={msg.toolStatus}
          toolArgs={msg.toolArgs}
        />
      ))}
      {isStreaming && lastMessage && (
        <Message
          key={lastMessage.id}
          role={lastMessage.role}
          content={lastMessage.content}
          toolName={lastMessage.toolName}
          toolStatus={lastMessage.toolStatus}
          toolArgs={lastMessage.toolArgs}
        />
      )}
    </Box>
  );
});
