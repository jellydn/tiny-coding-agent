import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import type { ToolExecution } from "../../core/agent.js";
import { TRUNCATE_LIMITS } from "../config/constants.js";
import { MessageRole, ToolStatus } from "../types/enums.js";

function formatGitCommand(name: string, args: Record<string, unknown> | undefined): string {
  if (name !== "bash") return name;

  const command = (args?.command as string) ?? "";
  if (!command) return "bash";

  const gitMatch = command.match(/^\s*git\s+(\S+)(.*)$/);
  if (!gitMatch) {
    return command.trim().startsWith("git ") ? command.trim() : "bash";
  }

  const subcommand = gitMatch[1] ?? "";
  const rest = gitMatch[2]?.trim() ?? "";

  if (subcommand === "diff" && rest.includes("--staged")) return "git diff --staged";
  if (subcommand === "log" && rest.includes("--oneline")) return "git log --oneline";
  if (
    ["show", "commit", "pull", "push", "remote", "tag", "stash", "config", "fetch"].includes(
      subcommand,
    )
  ) {
    return `git ${subcommand}`;
  }
  if (rest) return `git ${subcommand} ${rest}`;

  return `git ${subcommand}`;
}

function getToolStatusIcon(
  status: ToolStatus | "running" | "complete" | "error" | undefined,
): string {
  switch (status) {
    case ToolStatus.COMPLETE:
    case "complete":
      return "[✓]";
    case ToolStatus.ERROR:
    case "error":
      return "[✗]";
    default:
      return "[running]";
  }
}

function getToolStatusColor(
  status: ToolStatus | "running" | "complete" | "error" | undefined,
): string {
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
  const TOOL_MARKERS = ["[✓]", "[✗]", "[running]"];
  return TOOL_MARKERS.some((marker) => text.includes(marker));
}

interface SyntaxHighlightedProps {
  text: string;
}

const SYNTAX_PATTERNS: Array<{ test: (line: string) => boolean; color: string; bold?: boolean }> = [
  { test: (line) => line.startsWith("[File:"), color: "magenta", bold: true },
  { test: (line) => line.startsWith("+"), color: "green" },
  { test: (line) => line.startsWith("-"), color: "red" },
  { test: (line) => line.startsWith("@@"), color: "magenta" },
  { test: (line) => line.startsWith("diff --git"), color: "cyan" },
  { test: (line) => line.startsWith("index "), color: "cyan" },
  { test: (line) => line.startsWith("--- "), color: "yellow" },
  { test: (line) => line.startsWith("+++ "), color: "yellow" },
  { test: (line) => /^\s*\d+\s+files?\s+changed/.test(line), color: "cyan" },
  { test: (line) => /^\s*\d+\s+insertions?/.test(line), color: "green" },
  { test: (line) => /^\s*\d+\s+deletions?/.test(line), color: "red" },
  { test: (line) => /^[a-f0-9]{7,}\s/.test(line), color: "cyan" },
  { test: (line) => /\([^)]+\)$/.test(line), color: "green" },
  { test: (line) => /^(On branch |Your branch is)/.test(line), color: "cyan" },
  {
    test: (line) => /^(Changes to be committed:|Changes not staged|Untracked)/.test(line),
    color: "magenta",
    bold: true,
  },
  { test: (line) => /^(no changes|nothing to)/.test(line), color: "gray" },
  { test: (line) => line.startsWith("..."), color: "gray" },
];

function getSyntaxStyle(line: string): { color?: string; bold?: boolean } {
  for (const pattern of SYNTAX_PATTERNS) {
    if (pattern.test(line)) return { color: pattern.color, bold: pattern.bold };
  }
  return {};
}

const SyntaxHighlighted = memo(function SyntaxHighlighted({
  text,
}: SyntaxHighlightedProps): React.ReactElement {
  const lines = useMemo(() => text.split("\n"), [text]);

  const lineElements = useMemo(
    () =>
      lines.map((line, idx) => {
        const style = getSyntaxStyle(line);
        const { color, bold } = style;

        if (line.startsWith("[File:")) {
          return (
            <Text key={idx} color={color} bold={bold}>
              {line}
            </Text>
          );
        }

        const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (diffMatch) {
          return (
            <Text key={idx}>
              <Text color="cyan">diff --git a/</Text>
              <Text color="cyan" bold>
                {diffMatch[1]}
              </Text>
              <Text color="cyan"> b/</Text>
              <Text color="cyan" bold>
                {diffMatch[2]}
              </Text>
            </Text>
          );
        }

        const oldFileMatch = line.match(/^--- (a\/)?(.+)$/);
        if (oldFileMatch) {
          return (
            <Text key={idx}>
              <Text color="yellow">--- {oldFileMatch[1] ?? ""}</Text>
              <Text color="yellow" bold>
                {oldFileMatch[2]}
              </Text>
            </Text>
          );
        }

        const newFileMatch = line.match(/^\+\+\+ (b\/)?(.+)$/);
        if (newFileMatch) {
          return (
            <Text key={idx}>
              <Text color="yellow">+++ {newFileMatch[1] ?? ""}</Text>
              <Text color="yellow" bold>
                {newFileMatch[2]}
              </Text>
            </Text>
          );
        }

        if (/^.+\s+\|\s+\d+\s+[+-]+$/.test(line)) {
          const match = line.match(/^(.+?)(\s+\|\s+\d+\s+[+-]+)$/);
          if (match) {
            const filePart = match[1]!;
            const statPart = match[2]!;
            const renameMatch = filePart.match(/^(.+?)\s+=>/);
            if (renameMatch) {
              return (
                <Text key={idx}>
                  <Text color="white">{renameMatch[1]}</Text>
                  <Text color="yellow"> =&gt; </Text>
                  <Text color="white">{filePart.slice(renameMatch[0].length)}</Text>
                  <Text color="gray">{statPart}</Text>
                </Text>
              );
            }
            return (
              <Text key={idx}>
                <Text color="white">{filePart}</Text>
                <Text color="gray">{statPart}</Text>
              </Text>
            );
          }
        }

        const statusMatch = line.match(/^\s+((?:modified|new file|deleted|renamed):)/);
        if (statusMatch) {
          const idx = line.indexOf(statusMatch[1]!);
          return (
            <Text key={idx}>
              <Text color="yellow">{statusMatch[1]}</Text>
              <Text color="white">{line.slice(idx + statusMatch[1]!.length)}</Text>
            </Text>
          );
        }

        if (/^\s+/.test(line) && !/^(modified|new file|deleted|renamed)/.test(line.trim())) {
          const trimmed = line.trim();
          if (
            trimmed &&
            !trimmed.startsWith("#") &&
            !trimmed.startsWith("(") &&
            !trimmed.startsWith("...")
          ) {
            const indent = line.match(/^\s+/)?.[0] ?? "";
            return (
              <Text key={idx}>
                <Text color="gray">{indent}</Text>
                <Text color="white">{trimmed}</Text>
              </Text>
            );
          }
        }

        return (
          <Text key={idx} color={color} bold={bold}>
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

  const formattedName = formatGitCommand(name, args);
  const argsPreview = useMemo(() => {
    if (!args || Object.keys(args).length === 0) return "";
    return Object.entries(args)
      .filter(([, v]) => v !== undefined)
      .map(([, value]) => {
        const str = typeof value === "string" ? value : JSON.stringify(value);
        return str.length > TRUNCATE_LIMITS.TOOL_ARGS
          ? `${str.slice(0, TRUNCATE_LIMITS.TOOL_ARGS)}...`
          : str;
      })
      .join(" ");
  }, [args]);

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

  const statusText = isError ? "Error" : isComplete ? "Done" : "Running";

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
          {formattedName}
        </Text>
        <Text color="gray"> · {statusText}</Text>
      </Box>

      {argsPreview && (
        <Box marginTop={0}>
          <Text color="dimColor">{argsPreview}</Text>
        </Box>
      )}

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
