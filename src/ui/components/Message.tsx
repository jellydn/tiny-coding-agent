import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import type { ToolExecution } from "../../core/agent.js";
import { TRUNCATE_LIMITS } from "../config/constants.js";
import { MessageRole, ToolStatus } from "../types/enums.js";

type ToolStatusLike = ToolStatus | "running" | "complete" | "error";

function getToolStatusIcon(status?: ToolStatusLike): string {
  switch (status) {
    case ToolStatus.COMPLETE:
    case "complete":
      return "✓";
    case ToolStatus.ERROR:
    case "error":
      return "✗";
    default:
      return "⚙";
  }
}

function getToolStatusColor(status?: ToolStatusLike): string {
  switch (status) {
    case ToolStatus.COMPLETE:
    case "complete":
      return "green";
    case ToolStatus.ERROR:
    case "error":
      return "red";
    default:
      return "cyan";
  }
}

function hasToolMarkers(text: string): boolean {
  const TOOL_MARKERS = ["🔧", "✓", "✗"];
  return TOOL_MARKERS.some((marker) => text.includes(marker));
}

interface SyntaxHighlightedProps {
  text: string;
}

const SyntaxHighlighted = memo(function SyntaxHighlighted({
  text,
}: SyntaxHighlightedProps): React.ReactElement {
  const lines = useMemo(() => text.split("\n"), [text]);

  const lineElements = useMemo(
    () =>
      lines.map((line, idx) => {
        let color: string | undefined;

        if (line.startsWith("+")) {
          color = "green";
        } else if (line.startsWith("-")) {
          color = "red";
        } else if (line.startsWith("@@")) {
          color = "magenta";
        } else if (line.startsWith("diff --git") || line.startsWith("index ")) {
          color = "cyan";
        } else if (line.startsWith("---") || line.startsWith("+++")) {
          color = "yellow";
        }

        return (
          <Text key={`${idx}-${line.slice(0, 10)}`} color={color}>
            {line}
          </Text>
        );
      }),
    [lines],
  );

  return <Box flexDirection="column">{lineElements}</Box>;
});

interface InlineToolOutputProps {
  toolExecution: ToolExecution;
}

export const InlineToolOutput = memo(function InlineToolOutput({
  toolExecution,
}: InlineToolOutputProps): React.ReactElement {
  const { name, status, args, output, error } = toolExecution;
  const isComplete = status === ToolStatus.COMPLETE;
  const isError = status === ToolStatus.ERROR;

  const statusIcon = getToolStatusIcon(status);
  const statusColor = getToolStatusColor(status);

  const argsStr = useMemo(
    () =>
      args
        ? Object.entries(args)
            .filter(([, v]) => v !== undefined)
            .map(([, value]) => {
              const str = typeof value === "string" ? value : JSON.stringify(value);
              return str.length > TRUNCATE_LIMITS.TOOL_ARGS
                ? `${str.slice(0, TRUNCATE_LIMITS.TOOL_ARGS)}...`
                : str;
            })
            .join(" ")
        : "",
    [args],
  );

  const displayOutput = isError ? error : output;

  const truncatedOutput = useMemo(
    () =>
      displayOutput
        ? displayOutput.split("\n").slice(0, TRUNCATE_LIMITS.TOOL_OUTPUT_PREVIEW).join("\n")
        : "",
    [displayOutput],
  );

  const showMoreIndicator = useMemo(
    () =>
      displayOutput
        ? displayOutput.split("\n").length > TRUNCATE_LIMITS.TOOL_OUTPUT_PREVIEW
        : false,
    [displayOutput],
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={statusColor}
      paddingX={1}
      marginTop={1}
    >
      <Box>
        <Text color={statusColor}>{statusIcon}</Text>
        <Text color="white" bold>
          {" "}
          {name}
        </Text>
        {argsStr && <Text dimColor> {argsStr}</Text>}
      </Box>
      {(isComplete || isError) && displayOutput && (
        <Box flexDirection="column" marginTop={1}>
          <SyntaxHighlighted text={truncatedOutput} />
          {showMoreIndicator && <Text dimColor>...</Text>}
        </Box>
      )}
    </Box>
  );
});

interface MessageProps {
  role: MessageRole;
  content: string;
  toolName?: string;
  toolStatus?: ToolStatus;
  toolArgs?: Record<string, unknown>;
}

export const Message = memo(function Message({
  role,
  content,
  toolName,
  toolStatus,
  toolArgs,
}: MessageProps): React.ReactElement {
  const statusIcon = role === MessageRole.TOOL ? getToolStatusIcon(toolStatus) : "";
  const statusColor = role === MessageRole.TOOL ? getToolStatusColor(toolStatus) : "";

  const toolArgsStr = useMemo(
    () =>
      toolArgs && Object.keys(toolArgs).length > 0
        ? Object.entries(toolArgs)
            .filter(([, v]) => v !== undefined)
            .map(([, value]) => {
              const str = typeof value === "string" ? value : JSON.stringify(value);
              const truncated =
                str.length > TRUNCATE_LIMITS.TOOL_ARGS
                  ? str.slice(0, TRUNCATE_LIMITS.TOOL_ARGS) + "..."
                  : str;
              return ` =${truncated}`;
            })
            .join("")
        : "",
    [toolArgs],
  );

  const truncatedContent = useMemo(
    () =>
      content ? content.split("\n").slice(0, TRUNCATE_LIMITS.TOOL_OUTPUT_INLINE).join("\n") : "",
    [content],
  );

  const showContentMore = useMemo(
    () => (content ? content.split("\n").length > TRUNCATE_LIMITS.TOOL_OUTPUT_INLINE : false),
    [content],
  );

  if (role === MessageRole.TOOL) {
    return (
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Box alignItems="center">
          <Text color="gray">├</Text>
          <Text color={statusColor}> {statusIcon}</Text>
          <Text color="white" bold>
            {" "}
            {toolName}
          </Text>
          {toolArgsStr && <Text dimColor>{toolArgsStr}</Text>}
        </Box>
        {content && toolStatus !== ToolStatus.RUNNING && (
          <Box marginLeft={2}>
            <Text dimColor={toolStatus === ToolStatus.ERROR} wrap="wrap">
              {truncatedContent}
              {showContentMore && "\n..."}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  if (role === MessageRole.SEPARATOR) {
    return (
      <Box marginY={1}>
        <Text color="gray">────────────────────────────── </Text>
        <Text color="gray" dimColor>
          {content}
        </Text>
        <Text color="gray"> ──────────────────────────────</Text>
      </Box>
    );
  }

  const label = role === MessageRole.USER ? "You:" : "Assistant:";
  const color = role === MessageRole.USER ? "green" : "cyan";

  const hasToolOutput = role === MessageRole.ASSISTANT && hasToolMarkers(content);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {label}
      </Text>
      <Box marginTop={1}>
        {hasToolOutput ? (
          <SyntaxHighlighted text={content || "(no content)"} />
        ) : (
          <Text wrap="wrap">{content || "(no content)"}</Text>
        )}
      </Box>
    </Box>
  );
});
