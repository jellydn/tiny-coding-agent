import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileTools, globTool, ToolRegistry } from "../tools/index.js";
import {
	analyzeFiles,
	formatDependencyAnalysis,
	getDependencyAnalysis,
	getFileCount,
	getLocCount,
} from "./file-analyzer.js";

/**
 * CodebaseExplorer — owns a shared ToolRegistry and all the exploration
 * logic that was previously inlined across 4 separate functions in
 * explore-agent.ts (each with its own `new ToolRegistry()`).
 *
 * File analysis functions (getFileCount, getLocCount, getDependencyAnalysis)
 * have been extracted to file-analyzer.ts for independent testability and reuse.
 */

/** Result of an exploration — the report text plus structured metrics. */
export interface ExplorationOutput {
	report: string;
	metrics: Record<string, number | string>;
}

export class CodebaseExplorer {
	private readonly registry: ToolRegistry;

	constructor() {
		this.registry = new ToolRegistry();
		// Register tools needed for exploration (file analysis uses its own registry)
		this.registry.register({
			name: "glob",
			description: globTool.description,
			parameters: globTool.parameters,
			execute: globTool.execute,
		});
		this.registry.registerMany(fileTools);
	}

	/**
	 * Get an approximate count of source files by extension.
	 */
	async getFileCount(cwd: string): Promise<number> {
		return getFileCount(cwd);
	}

	/**
	 * Get an approximate line-of-code count by sampling up to 50 files per extension.
	 */
	async getLocCount(cwd: string): Promise<number> {
		return getLocCount(cwd);
	}

	/**
	 * Build a textual representation of the project's directory structure.
	 */
	async getProjectStructure(cwd: string): Promise<string> {
		const structureLines: string[] = [];

		try {
			const dirsResult = await this.registry.execute("glob", { pattern: "*", path: cwd });
			if (dirsResult.success && dirsResult.output) {
				const dirs = dirsResult.output.split("\n").filter((d) => d.trim());
				for (const dir of dirs) {
					if (dir.startsWith(".")) continue;
					structureLines.push(`- ${dir}/`);
				}
			}

			structureLines.push("\nsrc/");
			const srcResult = await this.registry.execute("glob", { pattern: "src/*", path: cwd });
			if (srcResult.success && srcResult.output) {
				const srcDirs = srcResult.output.split("\n").filter((d) => d.trim());
				for (const dir of srcDirs) {
					structureLines.push(`  - ${path.basename(dir)}/`);
				}
			}
		} catch (err) {
			structureLines.push(`Error exploring structure: ${(err as Error).message}`);
		}

		return structureLines.join("\n");
	}

	/**
	 * Read and format package.json metadata (name, version, dependencies).
	 */
	async getPackageInfo(cwd: string): Promise<string> {
		const packagePath = path.join(cwd, "package.json");
		try {
			const content = await fs.readFile(packagePath, "utf-8");
			const packageJson = JSON.parse(content) as {
				name?: string;
				version?: string;
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};

			const lines: string[] = [];
			lines.push(`Name: ${packageJson.name}`);
			lines.push(`Version: ${packageJson.version ?? "unknown"}`);
			lines.push("Dependencies:");

			if (packageJson.dependencies) {
				for (const [dep, version] of Object.entries(packageJson.dependencies)) {
					lines.push(`  - ${dep}: ${version}`);
				}
			}

			if (packageJson.devDependencies) {
				lines.push("Dev Dependencies:");
				for (const [dep, version] of Object.entries(packageJson.devDependencies)) {
					lines.push(`  - ${dep}: ${version}`);
				}
			}

			return lines.join("\n");
		} catch {
			return "package.json not found";
		}
	}

	/**
	 * Read and format tsconfig.json compiler options.
	 */
	async getTsConfigInfo(cwd: string): Promise<string> {
		const tsconfigPath = path.join(cwd, "tsconfig.json");
		try {
			const content = await fs.readFile(tsconfigPath, "utf-8");
			const tsconfig = JSON.parse(content) as {
				compilerOptions?: {
					target?: string;
					module?: string;
					strict?: boolean;
					esModuleInterop?: boolean;
					rootDir?: string;
					outDir?: string;
				};
			};

			const lines: string[] = [];
			lines.push("TypeScript Configuration:");

			if (tsconfig.compilerOptions) {
				const opts = tsconfig.compilerOptions;
				if (opts.target) lines.push(`  Target: ${opts.target}`);
				if (opts.module) lines.push(`  Module: ${opts.module}`);
				if (opts.strict) lines.push(`  Strict: ${opts.strict}`);
				if (opts.esModuleInterop) lines.push(`  ES Module Interop: true`);
				if (opts.rootDir) lines.push(`  Root Dir: ${opts.rootDir}`);
				if (opts.outDir) lines.push(`  Out Dir: ${opts.outDir}`);
			}

			return lines.join("\n");
		} catch {
			return "tsconfig.json not found";
		}
	}

	/**
	 * Detect git repository status (branch + remote presence).
	 */
	async getGitInfo(cwd: string): Promise<string> {
		const gitDir = path.join(cwd, ".git");
		try {
			await fs.access(gitDir);

			const lines: string[] = [];
			lines.push("Git Repository:");

			try {
				const headContent = await fs.readFile(path.join(gitDir, "HEAD"), "utf-8");
				const branchMatch = headContent.match(/ref: refs\/heads\/(.+)/);
				if (branchMatch?.[1]) {
					lines.push(`  Branch: ${branchMatch[1]}`);
				}
			} catch {
				lines.push("  Branch: unknown");
			}

			try {
				const remoteContent = await fs.readFile(path.join(gitDir, "config"), "utf-8");
				const remoteMatch = remoteContent.match(/\[remote "origin"\]/);
				if (remoteMatch) {
					lines.push("  Remote: origin (configured)");
				}
			} catch {
				// Ignore
			}

			return lines.join("\n");
		} catch {
			return "Not a git repository";
		}
	}

	/**
	 * Analyze external dependencies by grepping import statements across the codebase.
	 */
	async getDependencyAnalysis(cwd: string): Promise<string> {
		try {
			const deps = await getDependencyAnalysis(cwd);
			return formatDependencyAnalysis(deps);
		} catch (err) {
			return `Dependency Analysis:\n  Error analyzing dependencies: ${(err as Error).message}`;
		}
	}

	/**
	 * Run a shallow exploration: structure, package, tsconfig, git info.
	 * Returns the report text plus structured metrics (computed via getMetrics).
	 */
	async exploreShallow(cwd: string): Promise<ExplorationOutput> {
		const sections: string[] = [];

		sections.push("=== Project Structure ===");
		sections.push(await this.getProjectStructure(cwd));

		sections.push("\n=== Package Information ===");
		sections.push(await this.getPackageInfo(cwd));

		sections.push("\n=== TypeScript Configuration ===");
		sections.push(await this.getTsConfigInfo(cwd));

		sections.push("\n=== Git Information ===");
		sections.push(await this.getGitInfo(cwd));

		return { report: sections.join("\n"), metrics: await this.getMetrics(cwd) };
	}

	/**
	 * Run a deep exploration: shallow sections + dependency analysis + code metrics.
	 * Returns the report text plus structured metrics, reusing the file/LOC counts
	 * already computed for the report (avoids the double traversal that occurred
	 * when the orchestrator called getMetrics() separately).
	 */
	async exploreDeep(cwd: string): Promise<ExplorationOutput> {
		const sections: string[] = [];
		const metrics: Record<string, number | string> = {};

		sections.push("=== Full Project Structure ===");
		sections.push(await this.getProjectStructure(cwd));

		sections.push("\n=== Package Information ===");
		sections.push(await this.getPackageInfo(cwd));

		sections.push("\n=== TypeScript Configuration ===");
		sections.push(await this.getTsConfigInfo(cwd));

		sections.push("\n=== Git Information ===");
		sections.push(await this.getGitInfo(cwd));

		sections.push("\n=== Dependency Analysis ===");
		sections.push(await this.getDependencyAnalysis(cwd));

		try {
			const fileCount = await this.getFileCount(cwd);
			metrics.fileCount = fileCount;
			sections.push(`\n=== Code Metrics ===`);
			sections.push(`Total project files (approx): ${fileCount}`);
		} catch {
			metrics.fileCount = 0;
		}

		try {
			const locCount = await this.getLocCount(cwd);
			metrics.locCount = locCount;
			sections.push(`Lines of code (sample): ~${locCount}`);
		} catch {
			// locCount omitted on error
		}

		return { report: sections.join("\n"), metrics };
	}

	/**
	 * Collect code metrics (file count + LOC count) as a structured object.
	 * Used by the orchestrator to populate the result's `metrics` field.
	 */
	async getMetrics(cwd: string): Promise<Record<string, number | string>> {
		const result = await analyzeFiles(cwd);
		return { fileCount: result.fileCount, locCount: result.locCount };
	}
}
