import React from "react";
import { Text, Box } from "ink";
import type { ToolExecution } from "../../core/agent.js";

interface InlineToolOutputProps {
  toolExecution: ToolExecution;
}

export function InlineToolOutput({ toolExecution }: InlineToolOutputProps): React.ReactElement {
  const { name, status, args, output, error } = toolExecution;
  const isComplete = status === "complete";
  const isError = status === "error";
  const isRunning = status === "running";

  const statusIcon = isComplete ? "✓" : isError ? "✗" : "⚙";
  const statusColor = isComplete ? "green" : isError ? "red" : "cyan";

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box alignItems="center">
        <Text color="gray">├ </Text>
        <Text color={statusColor} bold>
          {statusIcon}
        </Text>
        <Text color="white" bold>
          {" "}
          {name}
        </Text>
        {args && Object.keys(args).length > 0 && (
          <Text dimColor>
            {" "}
            {Object.entries(args)
              .filter(([, v]) => v !== undefined)
              .map(([key, value]) => {
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
                const display = str.length > 40 ? `${str.slice(0, 40)}...` : str;
                return ` ${key}=${display}`;
              })
              .join("")}
          </Text>
        )}
        {isRunning && <Text color="cyan"> ...</Text>}
      </Box>
      {(isComplete || isError) && (output || error) && (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor={!isError} wrap="wrap">
            {(isError ? error : output)?.split("\n").slice(0, 3).join("\n") ?? ""}
            {(output?.split("\n").length ?? 0) > 3 && " ..."}
          </Text>
        </Box>
      )}
    </Box>
  );
}

interface MessageProps {
  role: "user" | "assistant";
  content: string;
  toolExecutions?: ToolExecution[];
}

export function Message({ role, content, toolExecutions }: MessageProps): React.ReactElement {
  const label = role === "user" ? "You:" : "Assistant:";
  const color = role === "user" ? "green" : "cyan";

  const completedToolExecutions = toolExecutions?.filter(
    (te) => te.status === "complete" || te.status === "error",
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {label}
      </Text>
      <Text wrap="wrap">{content}</Text>
      {completedToolExecutions?.map((te) => (
        <InlineToolOutput key={`${te.name}:${te.status}`} toolExecution={te} />
      ))}
    </Box>
  );
}
