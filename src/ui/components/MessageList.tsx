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

  return (
    <Box flexDirection="column">
      {visibleMessages.map((msg) => (
        <Message
          key={msg.id}
          role={msg.role}
          content={msg.content}
          toolName={msg.toolName}
          toolStatus={msg.toolStatus}
          toolArgs={msg.toolArgs}
        />
      ))}
    </Box>
  );
}
