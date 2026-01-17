import React, { useState, useEffect } from "react";
import { Text, Box, useInput, useStdout } from "ink";

interface ToolOutputProps {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
  maxVisibleLines?: number;
}

export function ToolOutput({
  name,
  success,
  output,
  error,
  maxVisibleLines,
}: ToolOutputProps): React.ReactElement {
  const statusIcon = success ? "✓" : "✗";
  const statusColor = success ? "green" : "red";
  const content = success ? output : error;
  const { stdout } = useStdout();

  const terminalHeight = stdout?.rows ?? 24;
  const effectiveMaxLines = maxVisibleLines ?? Math.max(10, terminalHeight - 10);

  const lines = content?.split("\n") ?? [];
  const totalLines = lines.length;
  const needsScrolling = totalLines > effectiveMaxLines;

  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    setScrollOffset(0);
  }, [content]);

  useInput(
    (input, key) => {
      if (!needsScrolling) return;

      if (key.downArrow || input === "j") {
        setScrollOffset((prev) => Math.min(prev + 1, totalLines - effectiveMaxLines));
      } else if (key.upArrow || input === "k") {
        setScrollOffset((prev) => Math.max(prev - 1, 0));
      } else if (key.pageDown) {
        setScrollOffset((prev) =>
          Math.min(prev + effectiveMaxLines, totalLines - effectiveMaxLines),
        );
      } else if (key.pageUp) {
        setScrollOffset((prev) => Math.max(prev - effectiveMaxLines, 0));
      }
    },
    { isActive: needsScrolling },
  );

  const visibleLines = needsScrolling
    ? lines.slice(scrollOffset, scrollOffset + effectiveMaxLines)
    : lines;

  const startLine = scrollOffset + 1;
  const endLine = Math.min(scrollOffset + effectiveMaxLines, totalLines);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={statusColor}
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text color={statusColor} bold>
          {statusIcon} {name}
        </Text>
        {needsScrolling && (
          <Text dimColor>
            Lines {startLine}-{endLine} of {totalLines}
          </Text>
        )}
      </Box>
      {content && (
        <Box flexDirection="column" marginTop={1}>
          <Text wrap="wrap" dimColor={!success}>
            {visibleLines.join("\n")}
          </Text>
          {needsScrolling && <Text dimColor>↑/↓ or j/k to scroll, PgUp/PgDn for pages</Text>}
        </Box>
      )}
    </Box>
  );
}
