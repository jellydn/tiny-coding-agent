import React from "react";
import { Box, Text } from "ink";

interface ContextStatusProps {
  tokensUsed?: number;
  tokensMax?: number;
}

function formatCompactNumber(num: number): string {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return String(num);
}

export function ContextStatus({ tokensUsed, tokensMax }: ContextStatusProps): React.ReactElement {
  if (tokensUsed === undefined || tokensMax === undefined) {
    return (
      <Box>
        <Text color="gray">Context: Ready</Text>
      </Box>
    );
  }

  const percentage = Math.round((tokensUsed / tokensMax) * 100);
  const usedDisplay = formatCompactNumber(tokensUsed);
  const maxDisplay = formatCompactNumber(tokensMax);

  let color: "gray" | "yellow" | "red" = "gray";
  if (percentage > 95) {
    color = "red";
  } else if (percentage > 80) {
    color = "yellow";
  }

  return (
    <Box>
      <Text>
        <Text color="gray">Ctx:</Text> {usedDisplay}/{maxDisplay} (
        <Text color={color}>{percentage}%</Text>)
      </Text>
    </Box>
  );
}
