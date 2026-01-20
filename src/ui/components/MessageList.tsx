import React from "react";
import { Box } from "ink";
import { Message } from "./Message.js";
import type { ChatMessage } from "../contexts/ChatContext.js";

export type { ChatMessage };

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((msg) => (
        <Message
          key={`${msg.role}:${msg.content.slice(0, 50)}`}
          role={msg.role}
          content={msg.content}
          toolExecutions={msg.toolExecutions}
        />
      ))}
    </Box>
  );
}
