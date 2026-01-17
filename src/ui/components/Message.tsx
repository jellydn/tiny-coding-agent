import React from "react";
import { Text, Box } from "ink";

type MessageRole = "user" | "assistant";

interface MessageProps {
  role: MessageRole;
  content: string;
}

export function Message({ role, content }: MessageProps): React.ReactElement {
  const label = role === "user" ? "You:" : "Agent:";
  const color = role === "user" ? "blue" : "green";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {label}
      </Text>
      <Text wrap="wrap">{content}</Text>
    </Box>
  );
}
