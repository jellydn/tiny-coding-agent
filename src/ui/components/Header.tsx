import React from "react";
import { Box, Text } from "ink";
import { detectProvider } from "../../providers/model-registry.js";

interface HeaderProps {
  model?: string;
}

export function Header({ model }: HeaderProps): React.ReactElement {
  let providerDisplay = "";
  let modelDisplay = model ?? "";

  if (model) {
    try {
      const provider = detectProvider(model);
      providerDisplay = provider;
      modelDisplay = model;
    } catch {
      providerDisplay = "unknown";
      modelDisplay = model;
    }
  }

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      width="100%"
    >
      <Text bold color="cyan">
        🤖 tiny-agent
      </Text>
      {model ? (
        <Text>
          <Text color="gray">{providerDisplay}: </Text>
          <Text color="green">{modelDisplay}</Text>
        </Text>
      ) : (
        <Text color="gray">No model selected</Text>
      )}
    </Box>
  );
}
