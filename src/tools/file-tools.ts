import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { z } from "zod";
import { findGitignorePatterns, isIgnored } from "./gitignore.js";

export function handleFileError(filePath: string, err: unknown, context: string): ToolResult {
  const error = err as NodeJS.ErrnoException;
  if (error.code === "ENOENT") {
    return { success: false, error: `File not found: ${filePath}` };
  }
  if (error.code === "EACCES") {
    return { success: false, error: `Permission denied: ${filePath}` };
  }
  return { success: false, error: `${context}: ${error.message}` };
}

const readFileArgsSchema = z.object({
  path: z.string(),
  start_line: z.number().optional(),
  end_line: z.number().optional(),
});

const writeFileArgsSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const editFileArgsSchema = z.object({
  path: z.string(),
  old_str: z.string(),
  new_str: z.string(),
  replace_all: z.boolean().optional(),
});

const listDirectoryArgsSchema = z.object({
  path: z.string(),
  recursive: z.boolean().optional(),
});

const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\.(?!example|sample|template|default)([a-zA-Z0-9_-]+)$/,
  /\.aws\/credentials$/,
  /\.aws\/config$/,
  /\.ssh\//,
  /\.npmrc$/,
  /\.git-credentials$/,
  /\.gitconfig$/,
  /\/etc\/passwd$/,
  /\/etc\/shadow$/,
  /\.pki\//,
  /\.gnupg\//,
];

function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(filePath) || pattern.test(basename));
}

interface PathValidationResult {
  valid: boolean;
  error?: string;
}

function validatePath(filePath: string): PathValidationResult {
  const normalized = path.normalize(filePath);

  // Check for directory traversal attempts
  if (normalized.includes("..")) {
    return { valid: false, error: 'Path cannot contain ".." for security reasons' };
  }

  const resolved = path.resolve(filePath);

  // Check if path attempts to write to sensitive system locations
  const sensitivePaths = [
    "/etc/",
    "/usr/",
    "/bin/",
    "/sbin/",
    "/sys/",
    "/proc/",
    "/dev/",
    "/root/",
  ];

  // Expand home directory for comparison
  const homeDir = process.env.HOME ?? "";
  const homeSensitivePaths = [
    path.join(homeDir, ".ssh"),
    path.join(homeDir, ".aws"),
    path.join(homeDir, ".gnupg"),
    path.join(homeDir, ".pki"),
  ];

  for (const sensitive of sensitivePaths) {
    if (resolved.startsWith(sensitive)) {
      return { valid: false, error: `Cannot write to system path: ${sensitive}` };
    }
  }

  for (const sensitive of homeSensitivePaths) {
    if (resolved.startsWith(sensitive)) {
      return {
        valid: false,
        error: `Cannot write to sensitive directory: ${path.basename(sensitive)}`,
      };
    }
  }

  return { valid: true };
}

export { isSensitiveFile, validatePath };

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read the contents of a file. Optionally specify a line range to read only a portion of the file.",
  dangerous: (args: Record<string, unknown>) => {
    const filePath = (args.path as string) ?? "";
    if (isSensitiveFile(filePath)) {
      return `Reading sensitive file: ${filePath}`;
    }
    return false;
  },
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the file to read",
      },
      start_line: {
        type: "number",
        description: "Optional start line number (1-indexed)",
      },
      end_line: {
        type: "number",
        description: "Optional end line number (1-indexed, inclusive)",
      },
    },
    required: ["path"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = readFileArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }

    const { path: filePath, start_line, end_line } = parsed.data;

    try {
      const resolvedPath = path.resolve(filePath);
      const gitignorePatterns = await findGitignorePatterns(resolvedPath);

      if (gitignorePatterns.length > 0) {
        const isFileIgnored = isIgnored(filePath, gitignorePatterns, false);
        if (isFileIgnored) {
          return {
            success: false,
            error: `File "${filePath}" is ignored by .gitignore. Use absolute path to read outside the repo.`,
          };
        }
      }

      const content = await fs.readFile(filePath, "utf-8");

      if (start_line !== undefined || end_line !== undefined) {
        const lines = content.split("\n");
        const start = (start_line ?? 1) - 1;
        const end = end_line ?? lines.length;
        const selectedLines = lines.slice(start, end);
        return { success: true, output: selectedLines.join("\n") };
      }

      return { success: true, output: content };
    } catch (err) {
      return handleFileError(filePath, err, "Failed to read file");
    }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Write content to a file. Creates the file and any parent directories if they don't exist. Overwrites existing content.",
  dangerous: "Will create or overwrite file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = writeFileArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }

    const { path: filePath, content } = parsed.data;

    // Validate path for security
    const pathValidation = validatePath(filePath);
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error };
    }

    // Check for sensitive file patterns
    if (isSensitiveFile(filePath)) {
      return { success: false, error: `Cannot write to sensitive file: ${filePath}` };
    }

    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return { success: true, output: `Successfully wrote to ${filePath}` };
    } catch (err) {
      return handleFileError(filePath, err, "Failed to write file");
    }
  },
};

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Edit a file by replacing specific text. Searches for the old_str and replaces it with new_str.",
  dangerous: "Will modify existing file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the file to edit",
      },
      old_str: {
        type: "string",
        description: "The text to search for in the file",
      },
      new_str: {
        type: "string",
        description: "The text to replace old_str with",
      },
      replace_all: {
        type: "boolean",
        description:
          "If true, replace all occurrences. If false (default), replace only the first occurrence.",
      },
    },
    required: ["path", "old_str", "new_str"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = editFileArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }

    const { path: filePath, old_str, new_str, replace_all } = parsed.data;

    // Validate old_str and new_str for path traversal attempts
    const pathTraversalPattern = /\.\.[\\/]/;
    if (pathTraversalPattern.test(old_str) || pathTraversalPattern.test(new_str)) {
      return { success: false, error: "Edit strings must not contain path traversal sequences" };
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");

      if (!content.includes(old_str)) {
        const preview = old_str.length > 50 ? `${old_str.slice(0, 50)}...` : old_str;
        return {
          success: false,
          error: `Text not found in file: "${preview}"`,
        };
      }

      const newContent = replace_all
        ? content.replaceAll(old_str, new_str)
        : content.replace(old_str, new_str);

      await fs.writeFile(filePath, newContent, "utf-8");

      const occurrences = replace_all ? content.split(old_str).length - 1 : 1;

      return {
        success: true,
        output: `Successfully replaced ${occurrences} occurrence(s) in ${filePath}`,
      };
    } catch (err) {
      return handleFileError(filePath, err, "Failed to edit file");
    }
  },
};

export const listDirectoryTool: Tool = {
  name: "list_directory",
  description:
    "List files and folders in a directory. Use this ONCE per directory to see what's available. Shows file type indicators (/ for directories). After listing, use read_file to examine specific files - do NOT list the same directory multiple times.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the directory to list",
      },
      recursive: {
        type: "boolean",
        description:
          "If true, list contents recursively. If false (default), list only top-level entries.",
      },
    },
    required: ["path"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const parsed = listDirectoryArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }

    const { path: dirPath, recursive } = parsed.data;

    try {
      const entries = await listDir(dirPath, recursive ?? false);
      return { success: true, output: entries.join("\n") };
    } catch (err) {
      return handleDirError(dirPath, err);
    }
  },
};

export function handleDirError(dirPath: string, err: unknown): ToolResult {
  const error = err as NodeJS.ErrnoException;
  if (error.code === "ENOENT") {
    return { success: false, error: `Directory not found: ${dirPath}` };
  }
  if (error.code === "EACCES") {
    return { success: false, error: `Permission denied: ${dirPath}` };
  }
  if (error.code === "ENOTDIR") {
    return { success: false, error: `Not a directory: ${dirPath}` };
  }
  return { success: false, error: `Failed to list directory: ${error.message}` };
}

async function listDir(dirPath: string, recursive: boolean, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      results.push(`${entryPath}/`);
      if (recursive) {
        const subEntries = await listDir(path.join(dirPath, entry.name), true, entryPath);
        results.push(...subEntries);
      }
    } else {
      results.push(entryPath);
    }
  }

  return results;
}

export const fileTools: Tool[] = [readFileTool, writeFileTool, editFileTool, listDirectoryTool];
