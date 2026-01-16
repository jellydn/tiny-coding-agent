import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolResult } from "./types.js";

const MAX_RESULTS = 100;
const MAX_LINE_LENGTH = 200;

export const grepTool: Tool = {
  name: "grep",
  description:
    "Search file contents with regex support. Returns matching lines with file paths and line numbers.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The regex pattern to search for",
      },
      path: {
        type: "string",
        description: "The directory or file path to search in (defaults to current directory)",
      },
      case_sensitive: {
        type: "boolean",
        description: "Whether the search is case-sensitive (default: true)",
      },
      include: {
        type: "string",
        description: "Glob pattern to filter files (e.g., '*.ts' to search only TypeScript files)",
      },
    },
    required: ["pattern"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const {
      pattern,
      path: searchPath,
      case_sensitive,
      include,
    } = args as {
      pattern: string;
      path?: string;
      case_sensitive?: boolean;
      include?: string;
    };

    try {
      const flags = case_sensitive ? "g" : "gi";
      const regex = new RegExp(pattern, flags);

      const results: string[] = [];
      await searchFiles(searchPath ?? ".", regex, include, results);

      if (results.length === 0) {
        return { success: true, output: "No matches found." };
      }

      const truncated = results.length > MAX_RESULTS;
      const output = results.slice(0, MAX_RESULTS).join("\n");

      return {
        success: true,
        output: truncated
          ? `${output}\n\n... (${results.length - MAX_RESULTS} more results truncated)`
          : output,
      };
    } catch (err) {
      if (err instanceof SyntaxError) {
        return { success: false, error: `Invalid regex pattern: ${pattern}` };
      }
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return { success: false, error: `Path not found: ${searchPath}` };
      }
      if (error.code === "EACCES") {
        return { success: false, error: `Permission denied: ${searchPath}` };
      }
      return { success: false, error: `Search failed: ${error.message}` };
    }
  },
};

async function searchFiles(
  searchPath: string,
  regex: RegExp,
  includePattern: string | undefined,
  results: string[],
): Promise<void> {
  const stat = await fs.stat(searchPath);

  if (stat.isFile()) {
    if (!includePattern || matchesGlob(path.basename(searchPath), includePattern)) {
      await searchInFile(searchPath, regex, results);
    }
    return;
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(searchPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const entryPath = path.join(searchPath, entry.name);
      if (entry.isDirectory()) {
        await searchFiles(entryPath, regex, includePattern, results);
      } else if (entry.isFile()) {
        if (!includePattern || matchesGlob(entry.name, includePattern)) {
          await searchInFile(entryPath, regex, results);
        }
      }

      if (results.length >= MAX_RESULTS * 2) break;
    }
  }
}

async function searchInFile(filePath: string, regex: RegExp, results: string[]): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      regex.lastIndex = 0;
      if (regex.test(line)) {
        const lineNum = i + 1;
        const truncatedLine =
          line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + "..." : line;
        results.push(`${filePath}:${lineNum}: ${truncatedLine.trim()}`);
      }
    }
  } catch {
    // Skip files that can't be read
  }
}

function matchesGlob(filename: string, pattern: string): boolean {
  const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(filename);
}

export const globTool: Tool = {
  name: "glob",
  description: "Find files by glob pattern (e.g., **/*.ts). Returns matching file paths.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.js', '*.json')",
      },
      path: {
        type: "string",
        description: "The directory to search in (defaults to current directory)",
      },
    },
    required: ["pattern"],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { pattern, path: searchPath } = args as {
      pattern: string;
      path?: string;
    };

    try {
      const results: string[] = [];
      await globFiles(searchPath ?? ".", pattern, "", results);

      if (results.length === 0) {
        return { success: true, output: "No matching files found." };
      }

      const truncated = results.length > MAX_RESULTS;
      const output = results.slice(0, MAX_RESULTS).join("\n");

      return {
        success: true,
        output: truncated
          ? `${output}\n\n... (${results.length - MAX_RESULTS} more results truncated)`
          : output,
      };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return { success: false, error: `Path not found: ${searchPath}` };
      }
      if (error.code === "EACCES") {
        return { success: false, error: `Permission denied: ${searchPath}` };
      }
      return { success: false, error: `Glob search failed: ${error.message}` };
    }
  },
};

async function globFiles(
  basePath: string,
  pattern: string,
  relativePath: string,
  results: string[],
): Promise<void> {
  const currentPath = relativePath ? path.join(basePath, relativePath) : basePath;

  const stat = await fs.stat(currentPath);
  if (!stat.isDirectory()) {
    if (matchesGlobPattern(relativePath || path.basename(basePath), pattern)) {
      results.push(currentPath);
    }
    return;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    const entryFullPath = path.join(basePath, entryRelativePath);

    if (entry.isDirectory()) {
      if (pattern.includes("**") || shouldDescendIntoDir(pattern, entryRelativePath)) {
        await globFiles(basePath, pattern, entryRelativePath, results);
      }
    } else if (entry.isFile()) {
      if (matchesGlobPattern(entryRelativePath, pattern)) {
        results.push(entryFullPath);
      }
    }

    if (results.length >= MAX_RESULTS * 2) break;
  }
}

function shouldDescendIntoDir(pattern: string, dirPath: string): boolean {
  const patternParts = pattern.split("/").filter((p) => p !== "**");
  const dirParts = dirPath.split(path.sep);

  for (let i = 0; i < dirParts.length && i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const dirPart = dirParts[i];
    if (patternPart && dirPart && !matchesGlob(dirPart, patternPart)) {
      return false;
    }
  }
  return true;
}

function matchesGlobPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.split(path.sep).join("/");

  let regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*\//g, "(.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

export const searchTools: Tool[] = [grepTool, globTool];
