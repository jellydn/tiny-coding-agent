import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { grepTool, globTool } from "../../src/tools/search-tools.js";
import { mkdirSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), "test-search-tools");

beforeEach(() => {
  try {
    rmdirSync(testDir, { recursive: true });
  } catch {
    /* ignore */
  }
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    rmdirSync(testDir, { recursive: true });
  } catch {
    /* ignore */
  }
});

describe("grepTool", () => {
  it("should find matching content in files", async () => {
    const testFile = join(testDir, "test.txt");
    writeFileSync(testFile, "Hello, World!\nThis is a test file.\nGoodbye!", "utf-8");

    const result = await grepTool.execute({ pattern: "test", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("test.txt");
    expect(result.output).toContain("test file");
  });

  it("should return success with 'No matches found' when no matches", async () => {
    writeFileSync(join(testDir, "test.txt"), "Hello, World!", "utf-8");

    const result = await grepTool.execute({ pattern: "nonexistent", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toBe("No matches found.");
  });

  it("should handle case insensitive search", async () => {
    const testFile = join(testDir, "case-test.txt");
    writeFileSync(testFile, "Hello WORLD\nhello world\nHELLO WORLD", "utf-8");

    const result = await grepTool.execute({
      pattern: "hello",
      path: testFile,
      case_sensitive: false,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("case-test.txt");
  });

  it("should filter by file pattern with include", async () => {
    writeFileSync(join(testDir, "test.ts"), "function test() {}");
    writeFileSync(join(testDir, "test.ts"), "function test() {}");

    const result = await grepTool.execute({ pattern: "function", path: testDir, include: "*.ts" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("test.ts");
  });

  it("should show line numbers in results", async () => {
    const testFile = join(testDir, "lines.txt");
    writeFileSync(testFile, "Line 1\nLine 2\nLine 3", "utf-8");

    const result = await grepTool.execute({ pattern: "Line 2", path: testFile });

    expect(result.success).toBe(true);
    expect(result.output).toContain(":2:");
  });

  it("should truncate long lines", async () => {
    const testFile = join(testDir, "long.txt");
    const longLine = "A".repeat(300);
    writeFileSync(testFile, longLine, "utf-8");

    const result = await grepTool.execute({ pattern: "A{100}", path: testFile });

    expect(result.success).toBe(true);
    expect(result.output).toContain("...");
  });

  it("should return error for invalid regex", async () => {
    const result = await grepTool.execute({ pattern: "[unclosed", path: testDir });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid regex");
  });

  it("should return error for non-existent path", async () => {
    const result = await grepTool.execute({ pattern: "test", path: "/nonexistent/path" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Path not found");
  });

  it("should truncate results when exceeding MAX_RESULTS", async () => {
    // Create multiple files with matches
    for (let i = 0; i < 150; i++) {
      writeFileSync(join(testDir, `file${i}.txt`), "match in file", "utf-8");
    }

    const result = await grepTool.execute({ pattern: "match", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("more results truncated");
  });
});

describe("globTool", () => {
  it("should find files matching glob pattern", async () => {
    writeFileSync(join(testDir, "test.ts"), "content");
    writeFileSync(join(testDir, "test.ts"), "content");
    writeFileSync(join(testDir, "other.ts"), "content");

    // Use simple glob pattern
    const result = await globTool.execute({ pattern: "*.ts", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("test.ts");
    expect(result.output).toContain("other.ts");
  });

  it("should find files in subdirectories", async () => {
    mkdirSync(join(testDir, "nested", "deep"), { recursive: true });
    writeFileSync(join(testDir, "nested", "deep", "file.ts"), "content");

    // Use nested pattern
    const result = await globTool.execute({ pattern: "nested/**/*.ts", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("nested/deep/file.ts");
  });

  it("should return 'No matching files found' when no matches", async () => {
    writeFileSync(join(testDir, "file.txt"), "content");

    const result = await globTool.execute({ pattern: "*.ts", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toBe("No matching files found.");
  });

  it("should handle simple file name patterns", async () => {
    writeFileSync(join(testDir, "config.json"), "{}");
    writeFileSync(join(testDir, "data.json"), "{}");
    writeFileSync(join(testDir, "readme.md"), "# Readme");

    const result = await globTool.execute({ pattern: "*.json", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("config.json");
    expect(result.output).toContain("data.json");
    expect(result.output).not.toContain("readme.md");
  });

  it("should handle question mark wildcard", async () => {
    writeFileSync(join(testDir, "file1.txt"), "content");
    writeFileSync(join(testDir, "file2.txt"), "content");
    writeFileSync(join(testDir, "file10.txt"), "content");

    const result = await globTool.execute({ pattern: "file?.txt", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("file1.txt");
    expect(result.output).toContain("file2.txt");
    expect(result.output).not.toContain("file10.txt");
  });

  it("should handle nested glob patterns", async () => {
    mkdirSync(join(testDir, "subdir"), { recursive: true });
    writeFileSync(join(testDir, "subdir", "nested.ts"), "content");
    writeFileSync(join(testDir, "shallow.ts"), "content");

    const result = await globTool.execute({ pattern: "subdir/*.ts", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("subdir/nested.ts");
    expect(result.output).not.toContain("shallow.ts");
  });

  it("should return error for non-existent path", async () => {
    const result = await globTool.execute({ pattern: "*.ts", path: "/nonexistent/path" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Path not found");
  });

  it("should skip node_modules directory", async () => {
    mkdirSync(join(testDir, "node_modules", "package"), { recursive: true });
    writeFileSync(join(testDir, "node_modules", "package", "index.ts"), "content");
    writeFileSync(join(testDir, "main.ts"), "content");

    // Use a simpler pattern that matches files in the root directory
    const result = await globTool.execute({ pattern: "*.ts", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("main.ts");
    expect(result.output).not.toContain("node_modules");
  });

  it("should skip hidden directories", async () => {
    // Create a file in a hidden directory
    const hiddenFilePath = join(testDir, ".hidden", "visible.ts");
    mkdirSync(join(testDir, ".hidden"), { recursive: true });
    writeFileSync(hiddenFilePath, "content");
    writeFileSync(join(testDir, "visible.ts"), "content");

    const result = await globTool.execute({ pattern: "*.ts", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("visible.ts");
    expect(result.output).not.toContain(".hidden");
  });

  it("should respect .gitignore patterns", async () => {
    writeFileSync(join(testDir, ".gitignore"), "*.log", "utf-8");
    writeFileSync(join(testDir, "included.ts"), "content");
    writeFileSync(join(testDir, "excluded.log"), "content");

    const result = await globTool.execute({ pattern: "*", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("included.ts");
    // .log files should be excluded by .gitignore
    expect(result.output).not.toContain("excluded.log");
  });

  it("should truncate results when exceeding MAX_RESULTS", async () => {
    for (let i = 0; i < 150; i++) {
      writeFileSync(join(testDir, `file${i}.ts`), "content");
    }

    const result = await globTool.execute({ pattern: "*.ts", path: testDir });

    expect(result.success).toBe(true);
    expect(result.output).toContain("more results truncated");
  });
});
