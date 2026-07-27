import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileTools, globTool, grepTool, ToolRegistry } from "../tools/index.js";

/**
 * CodebaseExplorer — owns a single shared ToolRegistry and all the file/glob/grep
 * exploration logic that was previously inlined across 4 separate functions in
 * explore-agent.ts (each with its own `new ToolRegistry()`).
 *
 * Deepening rationale (architecture review Candidate #4):
 * - 4 duplicate ToolRegistry instances → 1 shared registry
 * - 6 interleaved concerns (registry setup, fs.readFile, glob, grep, formatting, LLM) →
 *   exploration concerns live here; LLM + state-file concerns stay in explore-agent.ts
 * - N+1 file reads in getLocCount now share one registry instead of re-creating it per call
 * - Testable without an LLM: pass a temp dir, call exploreShallow(), assert the output
 */
export class CodebaseExplorer {
	private readonly registry: ToolRegistry;

	constructor() {
		this.registry = new ToolRegistry();
		// Register all tools once — shared across every exploration method
		this.registry.register({
			name: "glob",
			description: globTool.description,
			parameters: globTool.parameters,
			execute: globTool.execute,
		});
		this.registry.register({
			name: "grep",
			description: grepTool.description,
			parameters: grepTool.parameters,
			execute: grepTool.execute,
		});
		this.registry.registerMany(fileTools);
	}

	/**
	 * Get an approximate count of source files by extension.
	 */
	async getFileCount(cwd: string): Promise<number> {
		let totalCount = 0;
		const extensions = [".ts", ".tsx", ".js", ".jsx", ".json", ".md"];

		for (const ext of extensions) {
			try {
				const result = await this.registry.execute("glob", { pattern: `**/*${ext}`, path: cwd });
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
	async getLocCount(cwd: string): Promise<number> {
		let totalLoc = 0;
		const extensions = [".ts", ".tsx", ".js", ".jsx"];

		for (const ext of extensions) {
			try {
				const globResult = await this.registry.execute("glob", { pattern: `**/*${ext}`, path: cwd });
				if (globResult.success && globResult.output) {
					const files = globResult.output.split("\n").filter((f) => f.trim());
					for (const file of files.slice(0, 50)) {
						try {
							const readResult = await this.registry.execute("read_file", { path: file });
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
		const lines: string[] = [];
		lines.push("Dependency Analysis:");

		try {
			const importResult = await this.registry.execute("grep", {
				pattern: "^import.*from",
				path: cwd,
				type: "ts",
			});

			if (importResult.success && importResult.output) {
				const imports = importResult.output.split("\n").filter((i) => i.trim());
				const uniqueImports = new Set<string>();

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

				lines.push("  External dependencies used:");
				for (const dep of Array.from(uniqueImports).slice(0, 20)) {
					lines.push(`    - ${dep}`);
				}

				if (uniqueImports.size > 20) {
					lines.push(`    ... and ${uniqueImports.size - 20} more`);
				}
			}
		} catch (err) {
			lines.push(`  Error analyzing dependencies: ${(err as Error).message}`);
		}

		return lines.join("\n");
	}

	/**
	 * Run a shallow exploration: structure, package, tsconfig, git info.
	 */
	async exploreShallow(cwd: string): Promise<string> {
		const sections: string[] = [];

		sections.push("=== Project Structure ===");
		sections.push(await this.getProjectStructure(cwd));

		sections.push("\n=== Package Information ===");
		sections.push(await this.getPackageInfo(cwd));

		sections.push("\n=== TypeScript Configuration ===");
		sections.push(await this.getTsConfigInfo(cwd));

		sections.push("\n=== Git Information ===");
		sections.push(await this.getGitInfo(cwd));

		return sections.join("\n");
	}

	/**
	 * Run a deep exploration: shallow sections + dependency analysis + code metrics.
	 */
	async exploreDeep(cwd: string): Promise<string> {
		const sections: string[] = [];

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
			sections.push(`\n=== Code Metrics ===`);
			sections.push(`Total project files (approx): ${fileCount}`);
		} catch {
			// Ignore
		}

		try {
			const locCount = await this.getLocCount(cwd);
			sections.push(`Lines of code (sample): ~${locCount}`);
		} catch {
			// Ignore
		}

		return sections.join("\n");
	}

	/**
	 * Collect code metrics (file count + LOC count) as a structured object.
	 * Used by the orchestrator to populate the result's `metrics` field.
	 */
	async getMetrics(cwd: string): Promise<Record<string, number | string>> {
		const metrics: Record<string, number | string> = {};

		try {
			metrics.fileCount = await this.getFileCount(cwd);
		} catch {
			metrics.fileCount = 0;
		}

		try {
			metrics.locCount = await this.getLocCount(cwd);
		} catch {
			// locCount omitted on error
		}

		return metrics;
	}
}
