import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { z } from "zod";

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

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read the contents of a file. Optionally specify a line range to read only a portion of the file.",
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
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return { success: false, error: `File not found: ${filePath}` };
      }
      if (error.code === "EACCES") {
        return { success: false, error: `Permission denied: ${filePath}` };
      }
      return { success: false, error: `Failed to read file: ${error.message}` };
    }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Write content to a file. Creates the file and any parent directories if they don't exist. Overwrites existing content.",
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

    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return { success: true, output: `Successfully wrote to ${filePath}` };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "EACCES") {
        return { success: false, error: `Permission denied: ${filePath}` };
      }
      return {
        success: false,
        error: `Failed to write file: ${error.message}`,
      };
    }
  },
};

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Edit a file by replacing specific text. Searches for the old_str and replaces it with new_str.",
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

    try {
      const content = await fs.readFile(filePath, "utf-8");

      if (!content.includes(old_str)) {
        return {
          success: false,
          error: `Text not found in file: "${old_str.slice(0, 50)}${old_str.length > 50 ? "..." : ""}"`,
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
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return { success: false, error: `File not found: ${filePath}` };
      }
      if (error.code === "EACCES") {
        return { success: false, error: `Permission denied: ${filePath}` };
      }
      return { success: false, error: `Failed to edit file: ${error.message}` };
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
      return {
        success: false,
        error: `Failed to list directory: ${error.message}`,
      };
    }
  },
};

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
