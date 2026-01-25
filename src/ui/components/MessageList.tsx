import React from "react";
import { Box } from "ink";
import { Message } from "./Message.js";
import type { ChatMessage } from "../contexts/ChatContext.js";

export type { ChatMessage };

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps): React.ReactElement {
  const visibleMessages = messages.slice(-30);
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const isStreaming = lastMessage?.id === "streaming";

  const otherMessages = isStreaming ? visibleMessages.slice(0, -1) : visibleMessages;

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
      {/* Tool executions are shown via streaming text during streaming - no need to render ToolCall */}
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
}
