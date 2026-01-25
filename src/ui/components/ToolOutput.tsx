import React, { useState, useEffect } from "react";
import { Text, Box, useInput, useStdout, type Key } from "ink";

interface ToolOutputProps {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
  args?: Record<string, unknown>;
  maxVisibleLines?: number;
}

function formatArgValue(value: unknown, maxLen = 50): string {
  const str =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value) ?? String(value);
          } catch {
            return String(value);
          }
        })();
  return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
}

export function ToolOutput({
  name,
  success,
  output,
  error,
  args,
  maxVisibleLines,
}: ToolOutputProps): React.ReactElement {
  const statusIcon = success ? "[✓]" : "[✗]";
  const statusColor = success ? "green" : "red";
  const content = output || error;
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

  const maxScroll = Math.max(0, totalLines - effectiveMaxLines);

  const handleScrollInput = (input: string, key: Key): void => {
    if (!needsScrolling) return;

    if (key.downArrow || input === "j") {
      setScrollOffset((prev) => Math.min(prev + 1, maxScroll));
    } else if (key.upArrow || input === "k") {
      setScrollOffset((prev) => Math.max(prev - 1, 0));
    } else if (key.pageDown) {
      setScrollOffset((prev) => Math.min(prev + effectiveMaxLines, maxScroll));
    } else if (key.pageUp) {
      setScrollOffset((prev) => Math.max(prev - effectiveMaxLines, 0));
    }
  };

  useInput(handleScrollInput, { isActive: needsScrolling });

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
      {args && Object.keys(args).length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {Object.entries(args)
            .filter(([, v]) => v !== undefined)
            .map(([key, value]) => (
              <Text key={key} dimColor>
                <Text color="cyan">{key}</Text>: {formatArgValue(value)}
              </Text>
            ))}
        </Box>
      )}
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
