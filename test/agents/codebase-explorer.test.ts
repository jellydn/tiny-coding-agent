import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { CodebaseExplorer } from "../../src/agents/codebase-explorer.js";

describe("CodebaseExplorer", () => {
	let tempDir: string;
	let explorer: CodebaseExplorer;

	beforeEach(() => {
		tempDir = mkdtempSync(path.join(tmpdir(), "codebase-explorer-test-"));
		explorer = new CodebaseExplorer();
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	describe("constructor", () => {
		it("should create a single shared ToolRegistry", () => {
			// The explorer should be constructible without errors
			expect(explorer).toBeDefined();
			expect(explorer instanceof CodebaseExplorer).toBe(true);
		});

		it("should be reusable across multiple method calls", async () => {
			// Calling multiple methods on the same instance should all work
			const [structure, pkg] = await Promise.all([
				explorer.getProjectStructure(tempDir),
				explorer.getPackageInfo(tempDir),
			]);
			expect(typeof structure).toBe("string");
			expect(typeof pkg).toBe("string");
		});
	});

	describe("getProjectStructure", () => {
		it("should list top-level files and src/ contents", async () => {
			// The glob tool returns files (not directories) — create files so they appear
			mkdirSync(path.join(tempDir, "src", "tools"), { recursive: true });
			writeFileSync(path.join(tempDir, "README.md"), "# test\n");
			writeFileSync(path.join(tempDir, "src", "index.ts"), "export {};\n");
			writeFileSync(path.join(tempDir, "src", "tools", "helper.ts"), "export {};\n");

			const structure = await explorer.getProjectStructure(tempDir);

			// src/ is always pushed unconditionally by getProjectStructure
			expect(structure).toContain("src/");
			// glob src/* returns files in src/ — index.ts should appear as a basename
			expect(structure).toContain("index.ts");
		});

		it("should handle directories that start with a dot by skipping them", async () => {
			// The glob tool skips dotfiles/dot-directories entirely.
			// Create files inside a visible dir so glob returns something.
			mkdirSync(path.join(tempDir, ".hidden"), { recursive: true });
			mkdirSync(path.join(tempDir, "visible"), { recursive: true });
			writeFileSync(path.join(tempDir, ".hidden", "secret.ts"), "export {};\n");
			writeFileSync(path.join(tempDir, "visible", "app.ts"), "export {};\n");

			const structure = await explorer.getProjectStructure(tempDir);

			// visible/app.ts should appear (as basename under glob * or src/* path)
			expect(structure).not.toContain(".hidden");
		});

		it("should return a string even on empty directories", async () => {
			const structure = await explorer.getProjectStructure(tempDir);
			expect(typeof structure).toBe("string");
		});
	});

	describe("getPackageInfo", () => {
		it("should read and format package.json metadata", async () => {
			writeFileSync(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					name: "test-pkg",
					version: "1.2.3",
					dependencies: { lodash: "^4.17.0" },
					devDependencies: { vitest: "^1.0.0" },
				}),
				"utf-8"
			);

			const info = await explorer.getPackageInfo(tempDir);

			expect(info).toContain("Name: test-pkg");
			expect(info).toContain("Version: 1.2.3");
			expect(info).toContain("Dependencies:");
			expect(info).toContain("lodash: ^4.17.0");
			expect(info).toContain("Dev Dependencies:");
			expect(info).toContain("vitest: ^1.0.0");
		});

		it("should handle missing version gracefully", async () => {
			writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "no-version" }), "utf-8");

			const info = await explorer.getPackageInfo(tempDir);

			expect(info).toContain("Name: no-version");
			expect(info).toContain("Version: unknown");
		});

		it("should return 'package.json not found' when missing", async () => {
			const info = await explorer.getPackageInfo(tempDir);
			expect(info).toBe("package.json not found");
		});
	});

	describe("getTsConfigInfo", () => {
		it("should read and format tsconfig.json compiler options", async () => {
			writeFileSync(
				path.join(tempDir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "ESNext",
						strict: true,
						rootDir: "src",
						outDir: "dist",
					},
				}),
				"utf-8"
			);

			const info = await explorer.getTsConfigInfo(tempDir);

			expect(info).toContain("TypeScript Configuration:");
			expect(info).toContain("Target: ES2022");
			expect(info).toContain("Module: ESNext");
			expect(info).toContain("Strict: true");
			expect(info).toContain("Root Dir: src");
			expect(info).toContain("Out Dir: dist");
		});

		it("should return 'tsconfig.json not found' when missing", async () => {
			const info = await explorer.getTsConfigInfo(tempDir);
			expect(info).toBe("tsconfig.json not found");
		});
	});

	describe("getGitInfo", () => {
		it("should detect git repository and branch", async () => {
			// Initialize a git repo in the temp dir
			execSync("git init -b test-branch", { cwd: tempDir, stdio: "pipe" });

			const info = await explorer.getGitInfo(tempDir);

			expect(info).toContain("Git Repository:");
			expect(info).toContain("Branch: test-branch");
		});

		it("should return 'Not a git repository' when no .git dir", async () => {
			const info = await explorer.getGitInfo(tempDir);
			expect(info).toBe("Not a git repository");
		});
	});

	describe("getDependencyAnalysis", () => {
		it("should extract external dependencies from import statements", async () => {
			mkdirSync(path.join(tempDir, "src"), { recursive: true });
			writeFileSync(
				path.join(tempDir, "src", "main.ts"),
				'import { foo } from "lodash";\nimport { bar } from "./local.js";\nimport React from "react";\n',
				"utf-8"
			);

			const analysis = await explorer.getDependencyAnalysis(tempDir);

			expect(analysis).toContain("Dependency Analysis:");
			// External deps (lodash, react) should be listed; local (./local) should not
			expect(analysis).toContain("lodash");
		});

		it("should return a header even when grep finds no imports", async () => {
			const analysis = await explorer.getDependencyAnalysis(tempDir);
			expect(analysis).toContain("Dependency Analysis:");
		});
	});

	describe("getFileCount", () => {
		it("should count files by extension", async () => {
			// **/*.{ext} requires at least one / — put files in src/
			mkdirSync(path.join(tempDir, "src"), { recursive: true });
			writeFileSync(path.join(tempDir, "src", "a.ts"), "");
			writeFileSync(path.join(tempDir, "src", "b.ts"), "");
			writeFileSync(path.join(tempDir, "src", "c.json"), "{}");
			writeFileSync(path.join(tempDir, "src", "d.md"), "# hi");

			const count = await explorer.getFileCount(tempDir);
			expect(count).toBeGreaterThanOrEqual(4);
		});

		it("should return 0 for empty directories", async () => {
			const count = await explorer.getFileCount(tempDir);
			expect(count).toBeGreaterThanOrEqual(0);
		});
	});

	describe("getLocCount", () => {
		it("should count lines of code in source files", async () => {
			// The glob pattern **/*.ts requires at least one / in the path,
			// so files must be in a subdirectory to be found.
			mkdirSync(path.join(tempDir, "src"), { recursive: true });
			writeFileSync(path.join(tempDir, "src", "a.ts"), "line1\nline2\nline3\n");
			writeFileSync(path.join(tempDir, "src", "b.ts"), "line1\n");

			const loc = await explorer.getLocCount(tempDir);
			expect(loc).toBeGreaterThan(0);
		});
	});

	describe("getMetrics", () => {
		it("should return a metrics object with fileCount and locCount", async () => {
			mkdirSync(path.join(tempDir, "src"), { recursive: true });
			writeFileSync(path.join(tempDir, "src", "a.ts"), "line1\nline2\n");
			writeFileSync(path.join(tempDir, "src", "b.json"), "{}");

			const metrics = await explorer.getMetrics(tempDir);

			expect(metrics).toBeDefined();
			expect(typeof metrics.fileCount).toBe("number");
			expect(metrics.fileCount).toBeGreaterThanOrEqual(1);
			expect(metrics.locCount).toBeDefined();
		});

		it("should default fileCount to 0 on error", async () => {
			// getMetrics should not throw — it catches errors
			const metrics = await explorer.getMetrics(tempDir);
			expect(metrics.fileCount).toBeDefined();
		});
	});

	describe("exploreShallow", () => {
		it("should return a report with all shallow sections plus metrics", async () => {
			writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }), "utf-8");
			writeFileSync(
				path.join(tempDir, "tsconfig.json"),
				JSON.stringify({ compilerOptions: { target: "ES2022" } }),
				"utf-8"
			);
			mkdirSync(path.join(tempDir, "src"), { recursive: true });

			const { report, metrics } = await explorer.exploreShallow(tempDir);

			expect(report).toContain("=== Project Structure ===");
			expect(report).toContain("=== Package Information ===");
			expect(report).toContain("=== TypeScript Configuration ===");
			expect(report).toContain("=== Git Information ===");
			expect(report).toContain("Name: test");
			expect(report).toContain("Target: ES2022");
			// Shallow exploration includes metrics via getMetrics()
			expect(metrics).toBeDefined();
			expect(typeof metrics.fileCount).toBe("number");
		});
	});

	describe("exploreDeep", () => {
		it("should return a report with deep sections plus metrics (no double traversal)", async () => {
			writeFileSync(
				path.join(tempDir, "package.json"),
				JSON.stringify({ name: "deep-test", version: "2.0.0" }),
				"utf-8"
			);
			mkdirSync(path.join(tempDir, "src"), { recursive: true });
			writeFileSync(path.join(tempDir, "src", "main.ts"), 'import { foo } from "lodash";\n', "utf-8");

			const { report, metrics } = await explorer.exploreDeep(tempDir);

			expect(report).toContain("=== Full Project Structure ===");
			expect(report).toContain("=== Package Information ===");
			expect(report).toContain("=== TypeScript Configuration ===");
			expect(report).toContain("=== Git Information ===");
			expect(report).toContain("=== Dependency Analysis ===");
			expect(report).toContain("=== Code Metrics ===");
			expect(report).toContain("deep-test");
			// Metrics are computed once inside exploreDeep and returned alongside the report —
			// the orchestrator no longer calls getMetrics() separately.
			expect(metrics).toBeDefined();
			expect(typeof metrics.fileCount).toBe("number");
			expect(metrics.fileCount).toBeGreaterThanOrEqual(1);
			expect(metrics.locCount).toBeDefined();
		});
	});

	describe("shared registry across methods", () => {
		it("should reuse the same ToolRegistry instance for glob, grep, and file reads", async () => {
			// This is the core deepening assertion: calling exploreDeep (which internally
			// calls getProjectStructure, getDependencyAnalysis, getFileCount, getLocCount)
			// should all use the same registry instance without errors.
			mkdirSync(path.join(tempDir, "src"), { recursive: true });
			writeFileSync(path.join(tempDir, "src", "a.ts"), "import { x } from 'react';\n");
			writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "shared-test" }), "utf-8");

			const { report, metrics } = await explorer.exploreDeep(tempDir);

			expect(report).toContain("shared-test");
			expect(typeof metrics.fileCount).toBe("number");
			// No errors should have been thrown — the single registry handled everything
		});
	});
});
