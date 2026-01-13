import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolResult } from "./types.js";

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
    const filePath = args.path as string;
    const startLine = args.start_line as number | undefined;
    const endLine = args.end_line as number | undefined;

    try {
      const content = await fs.readFile(filePath, "utf-8");

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split("\n");
        const start = (startLine ?? 1) - 1;
        const end = endLine ?? lines.length;
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
    const filePath = args.path as string;
    const content = args.content as string;

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
    const filePath = args.path as string;
    const oldStr = args.old_str as string;
    const newStr = args.new_str as string;
    const replaceAll = (args.replace_all as boolean) ?? false;

    try {
      const content = await fs.readFile(filePath, "utf-8");

      if (!content.includes(oldStr)) {
        return {
          success: false,
          error: `Text not found in file: "${oldStr.slice(0, 50)}${oldStr.length > 50 ? "..." : ""}"`,
        };
      }

      const newContent = replaceAll
        ? content.replaceAll(oldStr, newStr)
        : content.replace(oldStr, newStr);

      await fs.writeFile(filePath, newContent, "utf-8");

      const occurrences = replaceAll ? content.split(oldStr).length - 1 : 1;

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
    "List files and folders in a directory. Shows file type indicators (/ for directories).",
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
    const dirPath = args.path as string;
    const recursive = (args.recursive as boolean) ?? false;

    try {
      const entries = await listDir(dirPath, recursive);
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
