import React from "react";
import { Text, Box } from "ink";

interface ToolOutputProps {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
}

export function ToolOutput({ name, success, output, error }: ToolOutputProps): React.ReactElement {
  const statusIcon = success ? "✓" : "✗";
  const statusColor = success ? "green" : "red";
  const content = success ? output : error;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={statusColor}
      paddingX={1}
      marginBottom={1}
    >
      <Box>
        <Text color={statusColor} bold>
          {statusIcon} {name}
        </Text>
      </Box>
      {content && (
        <Box marginTop={1}>
          <Text wrap="wrap" dimColor={!success}>
            {content}
          </Text>
        </Box>
      )}
    </Box>
  );
}
