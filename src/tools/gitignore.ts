import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface GitignorePattern {
  pattern: RegExp;
  negate: boolean;
  directoryOnly: boolean;
}

let patternCache = new Map<string, GitignorePattern[]>();

export async function loadGitignorePatterns(dirPath: string): Promise<GitignorePattern[]> {
  const resolvedPath = path.resolve(dirPath);

  if (patternCache.has(resolvedPath)) {
    return patternCache.get(resolvedPath)!;
  }

  try {
    const gitignorePath = path.join(resolvedPath, ".gitignore");
    const content = await fs.readFile(gitignorePath, "utf-8");
    const patterns = parseGitignore(content);
    patternCache.set(resolvedPath, patterns);
    return patterns;
  } catch {
    patternCache.set(resolvedPath, []);
    return [];
  }
}

export function parseGitignore(content: string): GitignorePattern[] {
  const patterns: GitignorePattern[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    let patternStr = trimmed;
    const negate = patternStr.startsWith("!");
    if (negate) {
      patternStr = patternStr.slice(1);
    }

    if (patternStr.startsWith("/")) {
      patternStr = patternStr.slice(1);
    }

    if (patternStr.endsWith("/")) {
      patternStr = patternStr.slice(0, -1);
    }

    let regexStr = patternStr
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "___GLOBSTAR___")
      .replace(/\*/g, "([^/]*)")
      .replace(/___GLOBSTAR___/g, "([^/]*(/[^/]*)*)")
      .replace(/\/+/g, "/");

    if (patternStr.startsWith("/")) {
      regexStr = `^${regexStr}`;
    } else {
      regexStr = `(^|/)${regexStr}`;
    }

    regexStr = `${regexStr}$`;

    patterns.push({
      pattern: new RegExp(regexStr, "i"),
      negate,
      directoryOnly: trimmed.endsWith("/"),
    });
  }

  return patterns;
}

export function isIgnored(
  filePath: string,
  patterns: GitignorePattern[],
  isDirectory: boolean,
): boolean {
  const normalizedPath = filePath.split(/[/\\]/).join("/");

  let ignored = false;

  for (const { pattern, negate, directoryOnly } of patterns) {
    if (directoryOnly && !isDirectory) {
      continue;
    }

    if (pattern.test(normalizedPath)) {
      if (negate) {
        ignored = false;
      } else {
        ignored = true;
      }
    }
  }

  return ignored;
}

export function clearPatternCache(): void {
  patternCache.clear();
}

export async function findGitignorePatterns(startPath: string): Promise<GitignorePattern[]> {
  const allPatterns: GitignorePattern[] = [];

  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;

  while (currentPath !== root && currentPath !== "/") {
    try {
      const patterns = await loadGitignorePatterns(currentPath);
      allPatterns.push(...patterns);
    } catch {
      // No .gitignore at this level, continue
    }
    currentPath = path.dirname(currentPath);
  }

  return allPatterns;
}
