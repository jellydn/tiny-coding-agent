/**
 * search-utils.ts — shared formatting and utility helpers for search tools.
 *
 * Extracted from search-tools.ts (Round 7 Candidate #5) so the glob-matching
 * and result-truncation logic can be reused without duplication between the
 * grep and glob tools.
 */

import * as path from "node:path";

/** Maximum results returned by any search tool. */
export const MAX_RESULTS = 100;

/** Maximum line length before truncating output lines. */
export const MAX_LINE_LENGTH = 200;

/**
 * Format search results with truncation when they exceed the limit.
 */
export function formatResults(results: string[], maxResults: number = MAX_RESULTS): string {
	if (results.length === 0) {
		return "No matching files found.";
	}

	const truncated = results.length > maxResults;
	const output = results.slice(0, maxResults).join("\n");

	return truncated ? `${output}\n\n... (${results.length - maxResults} more results truncated)` : output;
}

/**
 * Build a standard not-found error result for search tools.
 */
export function formatNotFound(path?: string): string {
	return `Path not found: ${path ?? "(unknown)"}`;
}

/**
 * Build a standard permission-denied error result for search tools.
 */
export function formatPermissionDenied(path?: string): string {
	return `Permission denied: ${path ?? "(unknown)"}`;
}

/**
 * Check whether a filename matches a glob pattern.
 */
export function matchesGlob(filename: string, pattern: string): boolean {
	const normalizedPath = filename.split(path.sep).join("/");

	// Replace "**" via a plain-text placeholder first so the "*" it expands
	// to is not re-processed by the single-wildcard replacement below (which
	// would turn "**/*.ts" into ".[^/]*/[^/]*\.ts" and break nested matches).
	const regexPattern = pattern
		.replace(/\*\*/g, "__GLOBSTAR__")
		.replace(/\./g, "\\.")
		.replace(/\*/g, "[^/]*")
		.replace(/__GLOBSTAR__/g, ".*")
		.replace(/\?/g, ".");

	const regex = new RegExp(`^${regexPattern}$`, "i");
	return regex.test(normalizedPath);
}

/**
 * Check whether the directory path could match a pattern.
 * Used to prune descending into non-matching directories.
 */
export function shouldDescendIntoDir(pattern: string, dirPath: string): boolean {
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
