import { spawn } from "node:child_process";
import type { Tool, ToolResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60000;

export const bashTool: Tool = {
  name: "bash",
  description:
    "Execute a shell command and return stdout, stderr, and exit code. Use for running builds, tests, scripts, and system commands.",
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
    const command = args.command as string;
    const cwd = args.cwd as string | undefined;
    const timeout = (args.timeout as number | undefined) ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let killed = false;

      const child = spawn(command, [], {
        shell: true,
        cwd,
        env: process.env,
      });

      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 1000);
      }, timeout);

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
            error: `Command timed out after ${timeout}ms`,
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
