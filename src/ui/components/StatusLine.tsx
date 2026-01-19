import React from "react";
import { Box, Text, useStdout } from "ink";

interface StatusLineProps {
  status?: "thinking" | "ready" | "error";
  model?: string;
  context?: string;
  tool?: string;
  elapsed?: number;
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
  context,
  tool,
  elapsed,
}: StatusLineProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;
  const elements: React.ReactNode[] = [];

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

  if (context) {
    if (elements.length > 0) {
      elements.push(<Text key={`sep-${elements.length}`}> | </Text>);
    }
    elements.push(
      <Text key="context">
        <Text color="gray">Ctx:</Text> {context}
      </Text>,
    );
  }

  if (tool) {
    const timeStr = elapsed !== undefined ? `${elapsed.toFixed(1)}s` : "";
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
