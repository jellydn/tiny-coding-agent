import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface GitignorePattern {
  pattern: RegExp;
  negate: boolean;
  directoryOnly: boolean;
}

interface CachedPatterns {
  patterns: GitignorePattern[];
  mtime: number;
}

let patternCache = new Map<string, CachedPatterns>();

export async function loadGitignorePatterns(dirPath: string): Promise<GitignorePattern[]> {
  const resolvedPath = path.resolve(dirPath);
  const gitignorePath = path.join(resolvedPath, ".gitignore");

  try {
    const stats = await fs.stat(gitignorePath);
    const cached = patternCache.get(resolvedPath);

    // Use cache if file hasn't been modified
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.patterns;
    }

    // Parse and cache with modification time
    const content = await fs.readFile(gitignorePath, "utf-8");
    const patterns = parseGitignore(content);
    patternCache.set(resolvedPath, { patterns, mtime: stats.mtimeMs });
    return patterns;
  } catch {
    // No .gitignore file or error reading it
    const cached = patternCache.get(resolvedPath);
    if (cached) {
      return cached.patterns;
    }
    patternCache.set(resolvedPath, { patterns: [], mtime: 0 });
    return [];
  }
}

export function parseGitignore(content: string): GitignorePattern[] {
  const patterns: GitignorePattern[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Guard clause: skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    let patternStr = trimmed;
    const negate = patternStr.startsWith("!");
    if (negate) {
      patternStr = patternStr.slice(1);
    }

    // Track if pattern has leading slash (anchored to root)
    const hasLeadingSlash = patternStr.startsWith("/");
    if (hasLeadingSlash) {
      patternStr = patternStr.slice(1);
    }

    // Track if pattern is directory-only
    const directoryOnly = patternStr.endsWith("/");
    if (directoryOnly) {
      patternStr = patternStr.slice(0, -1);
    }

    // Convert glob pattern to regex
    let regexStr = globToRegex(patternStr, hasLeadingSlash);

    patterns.push({
      pattern: new RegExp(regexStr, "i"),
      negate,
      directoryOnly: trimmed.endsWith("/"),
    });
  }

  return patterns;
}

/**
 * Convert a gitignore glob pattern to a RegExp string.
 * Handles wildcards, globstars, and special characters.
 */
function globToRegex(glob: string, hasLeadingSlash: boolean): string {
  const hasLeadingGlobstarSlash = glob.startsWith("**/");

  // Escape regex special chars except *, ?, [, ]
  const escaped = glob.replace(/[.+^${}()|\\]/g, "\\$&");

  // Convert glob patterns to regex
  let result = escaped
    .replace(/\*\*/g, "___GLOBSTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___GLOBSTAR___/g, ".*")
    .replace(/\?/g, ".");

  // Anchor the pattern
  if (hasLeadingSlash) {
    result = `^${result}(?:/|$)`;
  } else if (hasLeadingGlobstarSlash) {
    result = `^(?=.+/)${result}(?:/|$)`;
  } else {
    result = `(^|/)${result}(?:/|$)`;
  }

  return result;
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
