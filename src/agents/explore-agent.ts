import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadConfig } from "../config/loader.js";
import { createProvider, parseModelString } from "../providers/factory.js";
import type { Message } from "../providers/types.js";
import { fileTools, globTool, grepTool, ToolRegistry } from "../tools/index.js";
import { readStateFile, writeStateFile } from "./state.js";
import type { ExplorationResult, StateFile } from "./types.js";

export interface ExploreAgentOptions {
	stateFilePath?: string;
	depth?: "shallow" | "deep";
	verbose?: boolean;
}

export interface ExploreAgentResult {
	success: boolean;
	error?: string;
	findings?: string;
	recommendations?: string;
	metrics?: Record<string, number | string>;
}

const EXPLORE_SYSTEM_PROMPT = `You are a code analysis expert. Your task is to explore and analyze a codebase, providing insights, findings, recommendations, and metrics.

For each analysis, you should:
1. Examine the project structure and organization
2. Identify key files and their purposes
3. Detect patterns, frameworks, and technologies used
4. Analyze dependencies and their relationships
5. Look for code quality indicators
6. Identify potential issues or improvements

Output your analysis as a structured report with these sections:

# Codebase Analysis Report

## Overview
[Brief summary of the codebase purpose and structure]

## Key Findings
- [Finding 1]
- [Finding 2]
- [Finding 3]

## Architecture & Patterns
- [Pattern 1]
- [Pattern 2]

## Dependencies
- [Key dependencies and their purposes]

## Recommendations
- [Recommendation 1]
- [Recommendation 2]
- [Recommendation 3]

## Code Metrics
- Total files: [count]
- Total lines of code: [approximate count]
- Main languages: [list]
- Key directories: [list]

## Potential Issues
- [Issue 1]
- [Issue 2]

## Additional Observations
[Any other notable observations]`;

async function getFileCount(cwd: string): Promise<number> {
	const registry = new ToolRegistry();
	registry.register({
		name: "glob",
		description: globTool.description,
		parameters: globTool.parameters,
		execute: globTool.execute,
	});

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

async function getLocCount(cwd: string): Promise<number> {
	const registry = new ToolRegistry();
	registry.registerMany(fileTools);

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

async function getProjectStructure(cwd: string): Promise<string> {
	const registry = new ToolRegistry();
	registry.register({
		name: "glob",
		description: globTool.description,
		parameters: globTool.parameters,
		execute: globTool.execute,
	});

	const structureLines: string[] = [];

	try {
		const dirsResult = await registry.execute("glob", { pattern: "*", path: cwd });
		if (dirsResult.success && dirsResult.output) {
			const dirs = dirsResult.output.split("\n").filter((d) => d.trim());
			for (const dir of dirs) {
				if (dir.startsWith(".")) continue;
				structureLines.push(`- ${dir}/`);
			}
		}

		structureLines.push("\nsrc/");
		const srcResult = await registry.execute("glob", { pattern: "src/*", path: cwd });
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

async function getPackageInfo(cwd: string): Promise<string> {
	const packagePath = path.join(cwd, "package.json");
	try {
		const content = await fs.readFile(packagePath, "utf-8");
		const packageJson = JSON.parse(content);

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

async function getTsConfigInfo(cwd: string): Promise<string> {
	const tsconfigPath = path.join(cwd, "tsconfig.json");
	try {
		const content = await fs.readFile(tsconfigPath, "utf-8");
		const tsconfig = JSON.parse(content);

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

async function getGitInfo(cwd: string): Promise<string> {
	const gitDir = path.join(cwd, ".git");
	try {
		await fs.access(gitDir);

		const lines: string[] = [];
		lines.push("Git Repository:");

		try {
			const headContent = await fs.readFile(path.join(gitDir, "HEAD"), "utf-8");
			const branchMatch = headContent.match(/ref: refs\/heads\/(.+)/);
			if (branchMatch) {
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

async function getDependencyAnalysis(cwd: string): Promise<string> {
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

	const lines: string[] = [];
	lines.push("Dependency Analysis:");

	try {
		const importResult = await registry.execute("grep", {
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

async function exploreShallow(cwd: string): Promise<string> {
	const sections: string[] = [];

	sections.push("=== Project Structure ===");
	sections.push(await getProjectStructure(cwd));

	sections.push("\n=== Package Information ===");
	sections.push(await getPackageInfo(cwd));

	sections.push("\n=== TypeScript Configuration ===");
	sections.push(await getTsConfigInfo(cwd));

	sections.push("\n=== Git Information ===");
	sections.push(await getGitInfo(cwd));

	return sections.join("\n");
}

async function exploreDeep(cwd: string): Promise<string> {
	const sections: string[] = [];

	sections.push("=== Full Project Structure ===");
	sections.push(await getProjectStructure(cwd));

	sections.push("\n=== Package Information ===");
	sections.push(await getPackageInfo(cwd));

	sections.push("\n=== TypeScript Configuration ===");
	sections.push(await getTsConfigInfo(cwd));

	sections.push("\n=== Git Information ===");
	sections.push(await getGitInfo(cwd));

	sections.push("\n=== Dependency Analysis ===");
	sections.push(await getDependencyAnalysis(cwd));

	try {
		const fileCount = await getFileCount(cwd);
		sections.push(`\n=== Code Metrics ===`);
		sections.push(`Total project files (approx): ${fileCount}`);
	} catch {
		// Ignore
	}

	try {
		const locCount = await getLocCount(cwd);
		sections.push(`Lines of code (sample): ~${locCount}`);
	} catch {
		// Ignore
	}

	return sections.join("\n");
}

function createExploreMessages(taskDescription: string, codebaseContext: string): Message[] {
	return [
		{ role: "system", content: EXPLORE_SYSTEM_PROMPT },
		{
			role: "user",
			content: `## Task Description
${taskDescription}

## Codebase Context
${codebaseContext}

Perform a comprehensive analysis of the codebase and generate a detailed report with findings, recommendations, and metrics.`,
		},
	];
}

export async function exploreAgent(
	taskDescription: string,
	options?: ExploreAgentOptions
): Promise<ExploreAgentResult> {
	const stateFilePath = options?.stateFilePath || ".tiny-state.json";
	const depth = options?.depth || "shallow";
	const verbose = options?.verbose || false;

	if (verbose) {
		console.log("Starting explore agent...");
		console.log(`Task: ${taskDescription}`);
		console.log(`State file: ${stateFilePath}`);
		console.log(`Depth: ${depth}`);
	}

	const cwd = process.cwd();

	try {
		console.log(`📂 Exploring codebase (${depth} mode)...`);

		let codebaseContext: string;
		if (depth === "shallow") {
			codebaseContext = await exploreShallow(cwd);
		} else {
			codebaseContext = await exploreDeep(cwd);
		}
		console.log("✓ Codebase exploration complete");

		const config = loadConfig();
		const modelString = config.defaultModel;
		const { model: modelName } = parseModelString(modelString);

		console.log(`🤖 Generating analysis with ${modelName}...`);
		const client = createProvider({
			model: modelString,
			provider: undefined,
			providers: config.providers,
		});
		const messages = createExploreMessages(taskDescription, codebaseContext);

		const response = await client.chat({
			model: modelName,
			messages,
			temperature: 0.3,
			maxTokens: 8192,
		});

		const findings = response.content;
		console.log(`✓ Analysis generated (${findings.length} characters)`);

		let recommendations: string | undefined;
		let metrics: Record<string, number | string> | undefined;

		try {
			const fileCount = await getFileCount(cwd);
			metrics = { fileCount };
		} catch {
			metrics = { fileCount: 0 };
		}

		try {
			const locCount = await getLocCount(cwd);
			metrics = { ...metrics, locCount };
		} catch {
			// Ignore
		}

		recommendations = extractRecommendations(findings);

		if (options?.stateFilePath) {
			const existingState = await readStateFile(stateFilePath, { ignoreMissing: true });

			const explorationResult: ExplorationResult = {
				findings: extractFindingsList(findings),
				recommendations: extractRecommendationsList(recommendations),
				metrics: metrics || {},
			};

			const state: StateFile = existingState.success
				? {
						...existingState.data!,
						phase: "explore",
						status: "completed",
						results: {
							...existingState.data!.results,
							exploration: explorationResult,
						},
						errors: existingState.data!.errors,
					}
				: {
						metadata: {
							agentName: "tiny-agent",
							agentVersion: "1.0.0",
							invocationTimestamp: new Date().toISOString(),
							parameters: {
								depth,
							},
						},
						phase: "explore",
						taskDescription,
						status: "completed",
						results: {
							exploration: explorationResult,
						},
						errors: [],
						artifacts: [],
					};

			const writeResult = await writeStateFile(stateFilePath, state);
			if (!writeResult.success) {
				return {
					success: false,
					error: `Failed to write state file: ${writeResult.error}`,
				};
			}

			if (verbose) {
				console.log(`State file updated: ${stateFilePath}`);
			}
		}

		return {
			success: true,
			findings,
			recommendations,
			metrics,
		};
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : "Unknown error";
		return {
			success: false,
			error: `Exploration failed: ${errorMessage}`,
		};
	}
}

function extractRecommendations(content: string): string {
	const recSection = content.match(/## Recommendations\s*([\s\S]*?)(?=\n## |$)/i);
	if (recSection?.[1]) {
		return recSection[1].trim();
	}
	return "";
}

function extractFindingsList(content: string): string[] {
	const findings: string[] = [];
	const match = content.match(/## Key Findings\s*([\s\S]*?)(?=\n## |$)/i);
	if (match?.[1]) {
		const lines = match[1].split("\n");
		for (const line of lines) {
			const trimmed = line.replace(/^[-*•]\s*/, "").trim();
			if (trimmed && !trimmed.startsWith("##")) {
				findings.push(trimmed);
			}
		}
	}
	return findings;
}

function extractRecommendationsList(content: string): string[] {
	const recommendations: string[] = [];
	const lines = content.split("\n");
	for (const line of lines) {
		const trimmed = line.replace(/^[-*•]\s*/, "").trim();
		if (trimmed) {
			recommendations.push(trimmed);
		}
	}
	return recommendations;
}
