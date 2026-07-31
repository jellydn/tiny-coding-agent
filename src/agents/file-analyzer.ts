import { fileTools, globTool, grepTool, ToolRegistry } from "../tools/index.js";

/**
 * File analysis utilities extracted from CodebaseExplorer.
 *
 * Deepening rationale (architecture review Candidate #3):
 * - getFileCount, getLocCount, getDependencyAnalysis are pure file analysis
 *   concerns that don't depend on the CodebaseExplorer class state
 * - Extracting them makes them independently testable and reusable
 * - Reduces CodebaseExplorer from 381 lines to ~250 lines
 */

/** Result of file analysis operations. */
export interface FileAnalysisResult {
	fileCount: number;
	locCount: number;
	dependencies: string[];
}

/**
 * Create a shared ToolRegistry for file analysis operations.
 */
function createAnalysisRegistry(): ToolRegistry {
	const registry = new ToolRegistry();
	registry.register({
		name: "glob",
		description: globTool.description,
		parameters: globTool.parameters,
		execute: globTool.execute,
	});
	registry.register({
		name: "grep",
		description: grepTool.description,
		parameters: grepTool.parameters,
		execute: grepTool.execute,
	});
	registry.registerMany(fileTools);
	return registry;
}

/**
 * Get an approximate count of source files by extension.
 */
export async function getFileCount(cwd: string): Promise<number> {
	const registry = createAnalysisRegistry();
	let totalCount = 0;
	const extensions = [".ts", ".tsx", ".js", ".jsx", ".json", ".md"];

	for (const ext of extensions) {
		try {
			const result = await registry.execute("glob", { pattern: `**/*${ext}`, path: cwd });
			if (result.success && result.output) {
				const files = result.output.split("\n").filter((f) => f.trim());
				totalCount += files.length;
			}
		} catch {
			// Ignore errors
		}
	}

	return totalCount;
}

/**
 * Get an approximate line-of-code count by sampling up to 50 files per extension.
 */
export async function getLocCount(cwd: string): Promise<number> {
	const registry = createAnalysisRegistry();
	let totalLoc = 0;
	const extensions = [".ts", ".tsx", ".js", ".jsx"];

	for (const ext of extensions) {
		try {
			const globResult = await registry.execute("glob", { pattern: `**/*${ext}`, path: cwd });
			if (globResult.success && globResult.output) {
				const files = globResult.output.split("\n").filter((f) => f.trim());
				for (const file of files.slice(0, 50)) {
					try {
						const readResult = await registry.execute("read_file", { path: file });
						if (readResult.success && readResult.output) {
							totalLoc += readResult.output.split("\n").length;
						}
					} catch {
						// Ignore errors
					}
				}
			}
		} catch {
			// Ignore errors
		}
	}

	return totalLoc;
}

/**
 * Analyze external dependencies by grepping import statements across the codebase.
 */
export async function getDependencyAnalysis(cwd: string): Promise<string[]> {
	const registry = createAnalysisRegistry();
	const uniqueImports = new Set<string>();

	try {
		const importResult = await registry.execute("grep", {
			pattern: "^import.*from",
			path: cwd,
			include: "*.ts",
		});

		if (importResult.success && importResult.output) {
			const imports = importResult.output.split("\n").filter((i) => i.trim());

			for (const imp of imports) {
				const match = imp.match(/from\s+["']([^"']+)["']/);
				if (match?.[1]) {
					const impPath = match[1];
					if (!impPath.startsWith(".") && !impPath.startsWith("/")) {
						const firstSegment = impPath.split("/")[0];
						if (firstSegment) {
							uniqueImports.add(firstSegment);
						}
					}
				}
			}
		}
	} catch {
		// Ignore errors
	}

	return Array.from(uniqueImports);
}

/**
 * Run a complete file analysis: file count, LOC count, and dependency list.
 */
export async function analyzeFiles(cwd: string): Promise<FileAnalysisResult> {
	const [fileCount, locCount, dependencies] = await Promise.all([
		getFileCount(cwd).catch(() => 0),
		getLocCount(cwd).catch(() => 0),
		getDependencyAnalysis(cwd).catch(() => []),
	]);

	return { fileCount, locCount, dependencies };
}

/**
 * Format dependency analysis as a readable string.
 */
export function formatDependencyAnalysis(dependencies: string[], maxItems: number = 20): string {
	const lines: string[] = [];
	lines.push("Dependency Analysis:");
	lines.push("  External dependencies used:");

	for (const dep of dependencies.slice(0, maxItems)) {
		lines.push(`    - ${dep}`);
	}

	if (dependencies.length > maxItems) {
		lines.push(`    ... and ${dependencies.length - maxItems} more`);
	}

	return lines.join("\n");
}
