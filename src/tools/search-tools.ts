import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { isIgnored, findGitignorePatterns } from "./gitignore.js";

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
  maxDepth = 20,
): Promise<void> {
  // Use explicit stack to avoid recursion depth issues
  type SearchTask = {
    path: string;
    depth: number;
    gitignorePatterns: import("./gitignore.js").GitignorePattern[];
  };

  const stack: SearchTask[] = [];
  const visited = new Set<string>();

  // Initial task
  stack.push({
    path: searchPath,
    depth: 0,
    gitignorePatterns: [],
  });

  while (stack.length > 0) {
    const task = stack.pop()!;
    const { path: currentPath, depth } = task;

    // Early exit if depth exceeded
    if (depth > maxDepth) {
      console.warn(`Search depth limit (${maxDepth}) reached at ${currentPath}`);
      continue;
    }

    // Skip if already visited (prevents infinite loops with symlinks)
    const resolvedPath = path.resolve(currentPath);
    if (visited.has(resolvedPath)) {
      continue;
    }
    visited.add(resolvedPath);

    const stat = await fs.stat(currentPath).catch(() => null);
    if (!stat) {
      // For the initial path, throw an error so the user knows it doesn't exist
      if (depth === 0) {
        const error = new Error(`Path not found: ${searchPath}`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      continue;
    }

    if (stat.isFile()) {
      if (!includePattern || matchesGlob(path.basename(currentPath), includePattern)) {
        await searchInFile(currentPath, regex, results);
      }
      continue;
    }

    if (stat.isDirectory()) {
      // Get gitignore patterns for this directory
      const gitignorePatterns = await findGitignorePatterns(currentPath);

      const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "node_modules") continue;

        const entryPath = path.join(currentPath, entry.name);

        if (gitignorePatterns.length > 0) {
          const isDir = entry.isDirectory();
          if (isIgnored(entryPath, gitignorePatterns, isDir)) {
            continue;
          }
        }

        if (entry.isDirectory()) {
          stack.push({
            path: entryPath,
            depth: depth + 1,
            gitignorePatterns,
          });
        } else if (entry.isFile()) {
          if (!includePattern || matchesGlob(entry.name, includePattern)) {
            await searchInFile(entryPath, regex, results);
          }
        }

        if (results.length >= MAX_RESULTS * 2) break;
      }
    }
  }
}

async function searchInFile(filePath: string, regex: RegExp, results: string[]): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      regex.lastIndex = 0;
      if (line && regex.test(line)) {
        const lineNum = i + 1;
        const truncatedLine =
          line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + "..." : line;
        results.push(`${filePath}:${lineNum}: ${truncatedLine.trim()}`);
      }
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EACCES") {
      // Log permission errors but continue
      console.warn(`Skipping ${filePath}: permission denied`);
    } else if (error.code === "EISDIR") {
      // Skip directories silently
    } else if (error.code !== "ENOENT") {
      // Log unexpected errors (ENOENT is common due to race conditions)
      console.warn(`Skipping ${filePath}: ${error.message}`);
    }
  }
}

function matchesGlob(filename: string, pattern: string): boolean {
  const normalizedPath = filename.split(path.sep).join("/");

  let regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(normalizedPath);
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
  // Use explicit stack to avoid recursion depth issues
  type GlobTask = {
    basePath: string;
    relativePath: string;
  };

  const stack: GlobTask[] = [{ basePath, relativePath }];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const task = stack.pop()!;
    const { basePath: taskBasePath, relativePath: taskRelativePath } = task;

    const currentPath = taskRelativePath ? path.join(taskBasePath, taskRelativePath) : taskBasePath;

    // Skip if already visited (prevents infinite loops with symlinks)
    const resolvedPath = path.resolve(currentPath);
    if (visited.has(resolvedPath)) {
      continue;
    }
    visited.add(resolvedPath);

    const stat = await fs.stat(currentPath).catch(() => null);
    if (!stat) {
      // For the initial path, throw an error so the user knows it doesn't exist
      if (taskRelativePath === "" && results.length === 0) {
        const error = new Error(`Path not found: ${basePath}`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      continue;
    }

    if (!stat.isDirectory()) {
      if (matchesGlob(taskRelativePath || path.basename(taskBasePath), pattern)) {
        results.push(currentPath);
      }
      continue;
    }

    const gitignorePatterns = await findGitignorePatterns(taskBasePath);
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const entryRelativePath = taskRelativePath
        ? path.join(taskRelativePath, entry.name)
        : entry.name;
      const entryFullPath = path.join(taskBasePath, entryRelativePath);

      if (gitignorePatterns.length > 0) {
        const isDir = entry.isDirectory();
        if (isIgnored(entryRelativePath, gitignorePatterns, isDir)) {
          continue;
        }
      }

      if (entry.isDirectory()) {
        if (pattern.includes("**") || shouldDescendIntoDir(pattern, entryRelativePath)) {
          stack.push({
            basePath: taskBasePath,
            relativePath: entryRelativePath,
          });
        }
      } else if (entry.isFile()) {
        if (matchesGlob(entryRelativePath, pattern)) {
          results.push(entryFullPath);
        }
      }

      if (results.length >= MAX_RESULTS * 2) break;
    }
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

export const searchTools: Tool[] = [grepTool, globTool];
