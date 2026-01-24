import { spawn } from "node:child_process";
import type { Tool, ToolResult } from "./types.js";
import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 60000;

const READ_ONLY_COMMANDS = new Set([
  // Git read-only
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
  // Shell read-only
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
  // Test runners
  "npm test",
  "npm run test",
  "bun test",
  "pytest",
]);

const DESTRUCTIVE_PATTERNS = [
  /\brm\s/, // rm command
  /\bmv\s/, // mv command
  /\bgit\s+(commit|push|force-delete|branch\s+-D|reset\s+--hard|clean\s+-fdx?|rebase)\b/, // dangerous git
  /\brmdir\b/,
  // Output redirection to file (but not /dev/, /proc/, /sys/)
  // Matches: > file.txt, > /tmp/file.txt, > /home/user/file
  // Doesn't match: > /dev/null, > /proc/version, > echo test
  />[ \t]*(?!\/(?:dev|proc|sys)\/)[^\s|>]/,
  // Append redirection to file (same rules as output)
  />>[ \t]*(?!\/(?:dev|proc|sys)\/)[^\s|>]/,
  // Input redirection from file (same rules)
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

const SENSITIVE_ENV_PATTERNS = [
  /API_KEY/i,
  /SECRET/i,
  /PASSWORD/i,
  /TOKEN/i,
  /CREDENTIALS/i,
  /PRIVATE_KEY/i,
  /AWS_/i,
  /AZURE_/i,
  /GOOGLE_/i,
  /OPENAI_/i,
  /ANTHROPIC_/i,
];

const SAFE_ENV_KEYS = ["PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "NODE_ENV", "TZ"];

function filterSafeEnvironment(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};
  const isSafeKey = (key: string) => SAFE_ENV_KEYS.includes(key);
  const isSensitive = (key: string) => SENSITIVE_ENV_PATTERNS.some((p) => p.test(key));

  for (const [key, value] of Object.entries(process.env)) {
    if (value && (isSafeKey(key) || !isSensitive(key))) {
      safeEnv[key] = value;
    }
  }

  return safeEnv;
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

    return new Promise((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let killed = false;

      const child = spawn(command, [], {
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

      child.on("error", (err) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: `Failed to execute command: ${err.message}`,
        });
      });

      child.on("close", (exitCode) => {
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
