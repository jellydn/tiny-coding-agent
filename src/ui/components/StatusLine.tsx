import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";

interface StatusLineProps {
  status?: "thinking" | "ready" | "error";
  model?: string;
  tokensUsed?: number;
  tokensMax?: number;
  tool?: string;
  toolStartTime?: number;
}

function formatCompactNumber(num: number): string {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return String(num);
}

function truncateModel(model: string, maxLength: number): string {
  if (model.length <= maxLength) return model;
  return model.slice(0, maxLength - 3) + "...";
}

const STATUS_LABELS: Record<string, string> = {
  thinking: "⏳ Thinking",
  ready: "✓ Ready",
  error: "✗ Error",
};

const STATUS_COLORS: Record<string, string | undefined> = {
  thinking: "yellow",
  ready: "green",
  error: "red",
};

export function StatusLine({
  status,
  model,
  tokensUsed,
  tokensMax,
  tool,
  toolStartTime,
}: StatusLineProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;
  const elements: React.ReactNode[] = [];
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (tool && toolStartTime !== undefined) {
      const updateElapsed = () => {
        setElapsed((Date.now() - toolStartTime) / 1000);
      };
      updateElapsed();
      const interval = setInterval(updateElapsed, 100);
      return () => clearInterval(interval);
    }
    setElapsed(0);
  }, [tool, toolStartTime]);

  if (status) {
    if (elements.length > 0) {
      elements.push(<Text key={`sep-${elements.length}`}> | </Text>);
    }
    const statusLabel = STATUS_LABELS[status] || status;
    const statusColor = STATUS_COLORS[status];
    elements.push(
      <Text key="status" color={statusColor}>
        {statusLabel}
      </Text>,
    );
  }

  if (model) {
    if (elements.length > 0) {
      elements.push(<Text key={`sep-${elements.length}`}> | </Text>);
    }
    const maxModelWidth = Math.max(20, terminalWidth - 35);
    const truncatedModel = truncateModel(model, maxModelWidth);
    elements.push(
      <Text key="model">
        <Text color="gray">Model:</Text> {truncatedModel}
      </Text>,
    );
  }

  if (tokensUsed !== undefined && tokensMax !== undefined) {
    if (elements.length > 0) {
      elements.push(<Text key={`sep-${elements.length}`}> | </Text>);
    }
    const usedDisplay = formatCompactNumber(tokensUsed);
    const maxDisplay = formatCompactNumber(tokensMax);
    elements.push(
      <Text key="context">
        <Text color="gray">Ctx:</Text> {usedDisplay}/{maxDisplay}
      </Text>,
    );
  }

  if (tool) {
    const timeStr = `${elapsed.toFixed(1)}s`;
    if (elements.length > 0) {
      elements.push(<Text key={`sep-${elements.length}`}> | </Text>);
    }
    elements.push(
      <Text key="tool" color="cyan">
        ⚙ {tool} {timeStr}
      </Text>,
    );
  }

  if (elements.length === 0) {
    return <Box marginTop={1} />;
  }

  return (
    <Box marginTop={1} flexDirection="row">
      {elements}
    </Box>
  );
}
