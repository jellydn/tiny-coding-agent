import { spawn } from "node:child_process";
import type { Tool, ToolResult } from "./types.js";
import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 60000;

const READ_ONLY_COMMANDS = new Set([
  "git status",
  "git log",
  "git show",
  "git diff",
  "git config",
  "git branch",
  "git remote",
  "git tag",
  "git stash",
  "git reflog",
  "git describe",
  "git rev-parse",
  "git rev-list",
  "git merge-base",
  "git for-each-ref",
  "git name-rev",
  "git blame",
  "git log --oneline",
  "git log --pretty",
  "git log --format",
  "ls",
  "dir",
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "echo",
  "pwd",
  "which",
  "type",
  "file",
  "stat",
  "npm test",
  "npm run test",
  "bun test",
  "pytest",
]);

const DESTRUCTIVE_PATTERNS = [
  /\brm\s/,
  /\bmv\s/,
  /\bgit\s+(?:commit|push|force-delete|branch\s+-D|reset\s+--hard|clean\s+-fdx?|rebase|cherry-pick|revert|fetch|pull|merge\s+)\b/,
  /\bgit\s+checkout\s+-b\b/,
  /\brmdir\b/,
  />[ \t]*(?!\/(?:dev|proc|sys)\/)[^\s|>]/,
  />>[ \t]*(?!\/(?:dev|proc|sys)\/)[^\s|>]/,
  /<[ \t]*(?!\/(?:dev|proc|sys)\/)[^\s|>]/,
];

export function isDestructiveCommand(command: string): boolean {
  const trimmed = command.trim();

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  for (const readOnly of READ_ONLY_COMMANDS) {
    if (trimmed === readOnly || trimmed.startsWith(`${readOnly} `)) {
      return false;
    }
  }

  return false;
}

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "NODE_ENV",
  "TZ",
  "PWD",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "BROWSER",
  "TMPDIR",
  "TEMP",
  "TMP",
];

function filterSafeEnvironment(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};
  const allowlist = new Set(SAFE_ENV_KEYS);

  for (const [key, value] of Object.entries(process.env)) {
    if (value && allowlist.has(key)) {
      safeEnv[key] = value;
    }
  }

  return safeEnv;
}

function detectShellMetacharacters(command: string): string[] | null {
  const suspiciousPatterns: [RegExp, string][] = [
    [/;/, "semicolon"],
    [/\$/, "dollar sign"],
    [/`/, "backtick"],
    [/\n/, "newline"],
    [/\r/, "carriage return"],
    [/\((?![^)]*\))/, "parenthesis"],
  ];

  const detected: string[] = [];
  for (const [pattern, name] of suspiciousPatterns) {
    if (pattern.test(command)) {
      detected.push(name);
    }
  }

  return detected.length > 0 ? detected : null;
}

export interface BashOptions {
  strict?: boolean;
}

const bashArgsSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeout: z.number().optional(),
  strict: z.boolean().optional(),
});

export const bashTool: Tool = {
  name: "bash",
  description:
    "Execute a shell command and return stdout, stderr, and exit code. Use for running builds, tests, scripts, and system commands.",
  dangerous: (args) => {
    const { command, strict } = args as { command: string; strict?: boolean };
    if (isDestructiveCommand(command)) {
      return `Destructive command: ${command}`;
    }
    if (strict) {
      const metacharacters = detectShellMetacharacters(command);
      if (metacharacters) {
        return `Command contains shell metacharacters in strict mode: ${metacharacters.join(", ")}`;
      }
    }
    return false;
  },
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      cwd: {
        type: "string",
        description: "The working directory to execute the command in (default: current directory)",
      },
      timeout: {
        type: "number",
        description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
      },
      strict: {
        type: "boolean",
        description: "Block commands with shell metacharacters for security",
      },
    },
    required: ["command"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = bashArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }

    const { command, cwd, timeout, strict } = parsed.data;
    const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT_MS;

    const suspiciousChars = detectShellMetacharacters(command);
    if (suspiciousChars) {
      if (strict) {
        return {
          success: false,
          error: `[Security] Command blocked in strict mode: contains shell metacharacters ${suspiciousChars.join(", ")}`,
        };
      }
      console.warn(
        `[Security] Command contains potentially unsafe metacharacters: ${suspiciousChars.join(", ")}`,
      );
    }

    return new Promise((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let killed = false;

      const child = spawn(command, {
        shell: true,
        cwd,
        env: filterSafeEnvironment(),
      });

      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 1000);
      }, effectiveTimeout);

      child.stdout.on("data", (data: Buffer) => {
        stdout.push(data);
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr.push(data);
      });

      child.on("error", (err: Error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: `Failed to execute command: ${err.message}`,
        });
      });

      child.on("close", (exitCode: number) => {
        clearTimeout(timeoutId);

        const stdoutStr = Buffer.concat(stdout).toString("utf-8");
        const stderrStr = Buffer.concat(stderr).toString("utf-8");

        if (killed) {
          resolve({
            success: false,
            error:
              formatOutput(stdoutStr, stderrStr) || `Command timed out after ${effectiveTimeout}ms`,
          });
          return;
        }

        const output = formatOutput(stdoutStr, stderrStr);
        const hasOutput = stdoutStr.trim().length > 0 || stderrStr.trim().length > 0;
        const error = exitCode !== 0 ? (hasOutput ? undefined : `Command exited with code ${exitCode}`) : undefined;

        resolve({
          success: exitCode === 0,
          output,
          error,
        });
      });
    });
  },
};

function formatOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];

  if (stdout.trim()) {
    parts.push(stdout.trim());
  }

  if (stderr.trim()) {
    parts.push(`[stderr]\n${stderr.trim()}`);
  }

  return parts.join("\n\n") || "(no output)";
}

export const bashTools: Tool[] = [bashTool];
