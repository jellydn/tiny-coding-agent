import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useStdout } from "ink";
import { TIMING, FORMATTING, STATUS_CONFIG, LAYOUT } from "../config/constants.js";
import type { StatusType } from "../types/enums.js";

interface StatusLineProps {
  status?: StatusType;
  model?: string;
  tokensUsed?: number;
  tokensMax?: number;
  tool?: string;
}

function formatCompactNumber(num: number): string {
  if (num >= FORMATTING.COMPACT_NUMBER_THRESHOLD) {
    return `${(num / 1000).toFixed(FORMATTING.COMPACT_NUMBER_DECIMALS)}k`;
  }
  return String(num);
}

function truncateModel(model: string, maxLength: number): string {
  if (model.length <= maxLength) return model;
  return model.slice(0, maxLength - 3) + "...";
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
}: StatusLineProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;
  const elements: React.ReactNode[] = [];
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    startTimeRef.current = Date.now();
  }, [status, tool]);

  useEffect(() => {
    if ((status === "thinking" || tool) && startTimeRef.current) {
      const updateElapsed = () => {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      };
      updateElapsed();
      const interval = setInterval(updateElapsed, TIMING.TOOL_TIMER_UPDATE);
      return () => {
        clearInterval(interval);
        setElapsed(0);
      };
    }
    setElapsed(0);
  }, [status, tool]);

  if (status) {
    if (elements.length > 0) {
      elements.push(<Text key={`sep-${elements.length}`}> | </Text>);
    }
    const statusLabel = STATUS_CONFIG.LABELS[status] || status;
    const statusColor = STATUS_CONFIG.COLORS[status];
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
    const maxModelWidth = Math.max(
      LAYOUT.CONTEXT_MAX_MODEL_WIDTH,
      terminalWidth - LAYOUT.TERMINAL_WIDTH_BUFFER,
    );
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
  } else if (status === "thinking") {
    const timeStr = `${elapsed.toFixed(1)}s`;
    if (elements.length > 0) {
      elements.push(<Text key={`sep-${elements.length}`}> | </Text>);
    }
    elements.push(
      <Text key="thinking" color="yellow">
        ⏳ {timeStr}
      </Text>,
    );
  }

  if (elements.length === 0) {
    return (
      <Box flexDirection="row">
        <Text color="green">✓ Ready</Text>
        <Text> | </Text>
        <Text color="gray">Type a message to start</Text>
      </Box>
    );
  }

  return <Box flexDirection="row">{elements}</Box>;
}
