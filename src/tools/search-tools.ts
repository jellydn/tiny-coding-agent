import { globFiles, searchFiles } from "./file-traversal.js";
import { formatResults, formatSearchError } from "./search-utils.js";
import type { Tool, ToolResult } from "./types.js";

export const grepTool: Tool = {
	name: "grep",
	description: "Search file contents with regex support. Returns matching lines with file paths and line numbers.",
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

			return {
				success: true,
				output: formatResults(results),
			};
		} catch (err) {
			if (err instanceof SyntaxError) {
				return { success: false, error: `Invalid regex pattern: ${pattern}` };
			}
			return formatSearchError(err, searchPath, "Search");
		}
	},
};

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
			await globFiles(searchPath ?? ".", pattern, results);

			if (results.length === 0) {
				return { success: true, output: "No matching files found." };
			}

			return {
				success: true,
				output: formatResults(results),
			};
		} catch (err) {
			return formatSearchError(err, searchPath, "Glob search");
		}
	},
};
export const searchTools: Tool[] = [grepTool, globTool];
