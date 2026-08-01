/**
 * file-traversal.ts — shared file-tree walking for the search tools.
 *
 * Extracted from search-tools.ts (Round 10 Candidate #3). Both grep and
 * glob previously inlined the same stack-based, cycle-safe,
 * gitignore-aware directory walk (~45 duplicated lines each). This module
 * factors that traversal into a single walkFiles() helper that both tools
 * build on, plus the per-tool visitors searchFiles() and globFiles().
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { GitignorePattern } from "./gitignore.js";
import { findGitignorePatterns, isIgnored } from "./gitignore.js";
import { MAX_LINE_LENGTH, MAX_RESULTS, matchesGlob, shouldDescendIntoDir } from "./search-utils.js";

/** A file or directory discovered during a walk. */
export interface WalkedEntry {
	/** Full path of the entry. */
	path: string;
	/** Entry name (basename). */
	name: string;
	/** True when the entry is a directory. */
	isDirectory: boolean;
	/** Path relative to the walk's base path ("" for the base itself). */
	relativePath: string;
}

export interface WalkFilesOptions {
	/** The directory (or file) to walk from. */
	basePath: string;
	/** Maximum traversal depth (default: unlimited). */
	maxDepth?: number;
	/** Called for every file discovered. */
	onFile: (entry: WalkedEntry) => Promise<void> | void;
	/**
	 * Called before descending into a directory. Return false to skip it
	 * (e.g. glob-pattern pruning).
	 */
	shouldDescend?: (entry: WalkedEntry) => boolean;
	/** Called after each task and after each directory entry; return true to stop the walk early (result cap). */
	shouldStop?: () => boolean;
	/**
	 * Resolve gitignore patterns for a visited directory. Defaults to
	 * per-directory lookup (grep behavior).
	 */
	resolveGitignore?: (dirPath: string) => Promise<GitignorePattern[]>;
	/** Test gitignore against base-relative paths (glob) instead of absolute (grep). */
	relativeIgnorePaths?: boolean;
}

/**
 * Walk a file tree iteratively (explicit stack — no recursion-depth risk),
 * guarding against symlink cycles with a visited set, skipping hidden
 * entries and node_modules, and honoring .gitignore rules.
 *
 * Throws an ENOENT-tagged error when the base path does not exist.
 */
export async function walkFiles(options: WalkFilesOptions): Promise<void> {
	const {
		basePath,
		maxDepth,
		onFile,
		shouldDescend,
		shouldStop,
		resolveGitignore = findGitignorePatterns,
		relativeIgnorePaths = false,
	} = options;

	type WalkTask = {
		path: string;
		relativePath: string;
		depth: number;
	};

	const stack: WalkTask[] = [{ path: basePath, relativePath: "", depth: 0 }];
	const visited = new Set<string>();

	while (stack.length > 0) {
		if (shouldStop?.()) break;

		const task = stack.pop()!;
		const { path: currentPath, relativePath: taskRelativePath, depth } = task;

		if (maxDepth !== undefined && depth > maxDepth) {
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
				const error = new Error(`Path not found: ${basePath}`);
				(error as NodeJS.ErrnoException).code = "ENOENT";
				throw error;
			}
			continue;
		}

		if (stat.isFile()) {
			await onFile({
				path: currentPath,
				name: path.basename(currentPath),
				isDirectory: false,
				relativePath: taskRelativePath,
			});
			continue;
		}

		if (!stat.isDirectory()) continue;

		const gitignorePatterns = await resolveGitignore(currentPath);
		const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);

		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;

			const entryPath = path.join(currentPath, entry.name);
			const entryRelativePath = taskRelativePath ? path.join(taskRelativePath, entry.name) : entry.name;
			const isDir = entry.isDirectory();

			if (gitignorePatterns.length > 0) {
				const ignorePath = relativeIgnorePaths ? entryRelativePath : entryPath;
				if (isIgnored(ignorePath, gitignorePatterns, isDir)) {
					continue;
				}
			}

			const walked: WalkedEntry = {
				path: entryPath,
				name: entry.name,
				isDirectory: isDir,
				relativePath: entryRelativePath,
			};

			if (isDir) {
				if (shouldDescend && !shouldDescend(walked)) continue;
				stack.push({ path: entryPath, relativePath: entryRelativePath, depth: depth + 1 });
			} else {
				await onFile(walked);
			}

			// Halt mid-directory once the caller asks to stop (result cap).
			if (shouldStop?.()) break;
		}
	}
}

/** True once a walk has collected the soft result cap (2x the display limit). */
function hasReachedResultCap(results: string[]): boolean {
	return results.length >= MAX_RESULTS * 2;
}

/**
 * Search file contents under a path for lines matching a regex, appending
 * "path:line: content" entries to results. Honors an optional glob
 * include filter on file names.
 */
export async function searchFiles(
	searchPath: string,
	regex: RegExp,
	includePattern: string | undefined,
	results: string[],
	maxDepth = 20
): Promise<void> {
	await walkFiles({
		basePath: searchPath,
		maxDepth,
		shouldStop: () => hasReachedResultCap(results),
		onFile: async (entry) => {
			if (!includePattern || matchesGlob(entry.name, includePattern)) {
				await searchInFile(entry.path, regex, results);
			}
		},
	});
}

/**
 * Read a file and append matching lines to results. Permission and
 * read errors are logged and skipped (not thrown) so one bad file doesn't
 * abort the search.
 */
export async function searchInFile(filePath: string, regex: RegExp, results: string[]): Promise<void> {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			regex.lastIndex = 0;
			if (line && regex.test(line)) {
				const lineNum = i + 1;
				const truncatedLine = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line;
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

/**
 * Find files under a base path matching a glob pattern, appending full
 * paths to results. Prunes directories that cannot match the pattern and
 * skips descending when the pattern has no globstar.
 */
export async function globFiles(basePath: string, pattern: string, results: string[]): Promise<void> {
	await walkFiles({
		basePath,
		shouldStop: () => hasReachedResultCap(results),
		relativeIgnorePaths: true,
		resolveGitignore: () => findGitignorePatterns(basePath),
		shouldDescend: (entry) => pattern.includes("**") || shouldDescendIntoDir(pattern, entry.relativePath),
		onFile: (entry) => {
			if (matchesGlob(entry.relativePath || entry.name, pattern)) {
				results.push(entry.path);
			}
		},
	});
}
