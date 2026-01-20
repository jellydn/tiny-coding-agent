import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  model?: string;
}

export function Header({ model }: HeaderProps): React.ReactElement {
  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan">
        🤖 tiny-agent
      </Text>
      {model && (
        <Text>
          <Text color="gray">Model:</Text> <Text color="green">{model}</Text>
        </Text>
      )}
    </Box>
  );
}
