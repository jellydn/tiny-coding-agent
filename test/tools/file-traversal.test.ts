import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globFiles, searchFiles, searchInFile, walkFiles } from "../../src/tools/file-traversal.js";

const testDir = join(tmpdir(), "test-file-traversal");

beforeEach(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
	mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe("walkFiles", () => {
	it("should walk files recursively and skip hidden entries and node_modules", async () => {
		writeFileSync(join(testDir, "a.ts"), "content");
		mkdirSync(join(testDir, "nested"), { recursive: true });
		writeFileSync(join(testDir, "nested", "b.ts"), "content");
		writeFileSync(join(testDir, ".hidden.ts"), "content");
		mkdirSync(join(testDir, "node_modules", "pkg"), { recursive: true });
		writeFileSync(join(testDir, "node_modules", "pkg", "c.ts"), "content");

		const files: string[] = [];
		await walkFiles({
			basePath: testDir,
			onFile: (entry) => {
				files.push(entry.name);
			},
		});

		expect(files).toContain("a.ts");
		expect(files).toContain("b.ts");
		expect(files).not.toContain(".hidden.ts");
		expect(files).not.toContain("c.ts");
	});

	it("should throw ENOENT for a non-existent base path", async () => {
		await expect(
			walkFiles({
				basePath: join(testDir, "missing"),
				onFile: () => {},
			})
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("should respect shouldDescend to prune directories", async () => {
		mkdirSync(join(testDir, "skip-me"), { recursive: true });
		writeFileSync(join(testDir, "skip-me", "x.ts"), "content");
		writeFileSync(join(testDir, "keep.ts"), "content");

		const files: string[] = [];
		await walkFiles({
			basePath: testDir,
			shouldDescend: (entry) => entry.name !== "skip-me",
			onFile: (entry) => {
				files.push(entry.name);
			},
		});

		expect(files).toEqual(["keep.ts"]);
	});

	it("should honor shouldStop to halt the walk early", async () => {
		for (let i = 0; i < 5; i++) {
			writeFileSync(join(testDir, `f${i}.txt`), "content");
		}

		const files: string[] = [];
		await walkFiles({
			basePath: testDir,
			shouldStop: () => files.length >= 2,
			onFile: (entry) => {
				files.push(entry.name);
			},
		});

		expect(files.length).toBe(2);
	});
});

describe("searchFiles / searchInFile", () => {
	it("should find matching lines with file paths and line numbers", async () => {
		writeFileSync(join(testDir, "a.txt"), "alpha\nbeta\ngamma", "utf-8");

		const results: string[] = [];
		await searchFiles(testDir, /beta/, undefined, results);

		expect(results).toHaveLength(1);
		expect(results[0]).toContain("a.txt:2");
		expect(results[0]).toContain("beta");
	});

	it("should respect include pattern", async () => {
		writeFileSync(join(testDir, "a.ts"), "match here", "utf-8");
		writeFileSync(join(testDir, "a.txt"), "match here", "utf-8");

		const results: string[] = [];
		await searchFiles(testDir, /match/, "*.ts", results);

		expect(results).toHaveLength(1);
		expect(results[0]).toContain("a.ts");
	});

	it("searchInFile should skip unreadable files without throwing", async () => {
		const filePath = join(testDir, "missing.txt");

		const results: string[] = [];
		await expect(searchInFile(filePath, /anything/, results)).resolves.toBeUndefined();
		expect(results).toEqual([]);
	});
});

describe("globFiles", () => {
	it("should find files matching a glob pattern", async () => {
		writeFileSync(join(testDir, "a.ts"), "content");
		writeFileSync(join(testDir, "b.js"), "content");

		const results: string[] = [];
		await globFiles(testDir, "*.ts", results);

		expect(results).toHaveLength(1);
		expect(results[0]).toContain("a.ts");
	});

	it("should match nested paths with globstar patterns", async () => {
		mkdirSync(join(testDir, "nested", "deep"), { recursive: true });
		writeFileSync(join(testDir, "nested", "deep", "c.ts"), "content");

		const results: string[] = [];
		await globFiles(testDir, "**/*.ts", results);

		expect(results).toHaveLength(1);
		expect(results[0]).toContain("nested/deep/c.ts");
	});

	it("should respect .gitignore patterns", async () => {
		writeFileSync(join(testDir, ".gitignore"), "*.log", "utf-8");
		writeFileSync(join(testDir, "included.ts"), "content");
		writeFileSync(join(testDir, "excluded.log"), "content");

		const results: string[] = [];
		await globFiles(testDir, "*", results);

		expect(results.some((r) => r.endsWith("included.ts"))).toBe(true);
		expect(results.some((r) => r.endsWith("excluded.log"))).toBe(false);
	});
});
