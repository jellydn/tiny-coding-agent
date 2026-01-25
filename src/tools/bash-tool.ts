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
  /\bgit\s+(commit|push|force-delete|branch\s+-D|reset\s+--hard|clean\s+-fdx?|rebase)\b/,
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

function detectShellMetacharacters(command: string): string[] {
  const metacharacters: string[] = [];
  const patterns: [RegExp, string][] = [
    [/;/, "semicolon"],
    [/\|/, "pipe"],
    [/\$/, "variable expansion"],
    [/`/, "command substitution"],
    [/\n/, "newline"],
    [/\r/, "carriage return"],
    [/&&/, "AND operator"],
    [/\|\|/, "OR operator"],
    [/<</, "heredoc"],
    [/>/, "redirection"],
    [/>>/, "append redirection"],
  ];

  for (const [pattern, name] of patterns) {
    if (pattern.test(command)) {
      metacharacters.push(name);
    }
  }

  return metacharacters;
}

const bashArgsSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeout: z.number().optional(),
});

export const bashTool: Tool = {
  name: "bash",
  description:
    "Execute a shell command and return stdout, stderr, and exit code. Use for running builds, tests, scripts, and system commands.",
  dangerous: (args) => {
    const { command } = args as { command: string };
    if (isDestructiveCommand(command)) {
      return `Destructive command: ${command}`;
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
    },
    required: ["command"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = bashArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }

    const { command, cwd, timeout } = parsed.data;
    const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT_MS;

    const metacharacters = detectShellMetacharacters(command);
    if (metacharacters.length > 0) {
      const warning = `[Security] Command contains shell metacharacters: ${metacharacters.join(", ")}. This is allowed for legitimate shell usage but review the command if unexpected.`;
      console.warn(warning);
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
            error: `Command timed out after ${effectiveTimeout}ms`,
            output: formatOutput(stdoutStr, stderrStr, null),
          });
          return;
        }

        const output = formatOutput(stdoutStr, stderrStr, exitCode);

        resolve({
          success: exitCode === 0,
          output,
          error: exitCode !== 0 ? `Command exited with code ${exitCode}` : undefined,
        });
      });
    });
  },
};

function formatOutput(stdout: string, stderr: string, exitCode: number | null): string {
  const parts: string[] = [];

  if (stdout.trim()) {
    parts.push(`stdout:\n${stdout.trim()}`);
  }

  if (stderr.trim()) {
    parts.push(`stderr:\n${stderr.trim()}`);
  }

  if (exitCode !== null) {
    parts.push(`exit_code: ${exitCode}`);
  }

  return parts.join("\n\n") || "(no output)";
}

export const bashTools: Tool[] = [bashTool];
