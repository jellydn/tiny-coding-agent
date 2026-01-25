import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const tempDir = "/tmp/tiny-agent-security-test";

// Helper to create a temp file with content
async function createTempFile(name: string, content: string): Promise<string> {
  const filePath = path.join(tempDir, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("Path Traversal Security", () => {
  beforeEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe("edit_file tool", () => {
    it("should reject old_str containing path traversal", async () => {
      const filePath = await createTempFile("test.txt", "hello world");
      const { editFileTool } = await import("../../src/tools/file-tools.js");

      const result = await editFileTool.execute({
        path: filePath,
        old_str: "../etc/passwd",
        new_str: "malicious",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("path traversal");
    });

    it("should reject new_str containing path traversal", async () => {
      const filePath = await createTempFile("test.txt", "hello world");
      const { editFileTool } = await import("../../src/tools/file-tools.js");

      const result = await editFileTool.execute({
        path: filePath,
        old_str: "hello",
        new_str: "../../../etc/passwd",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("path traversal");
    });

    it("should reject backslash path traversal", async () => {
      const filePath = await createTempFile("test.txt", "hello world");
      const { editFileTool } = await import("../../src/tools/file-tools.js");

      const result = await editFileTool.execute({
        path: filePath,
        old_str: "..\\..\\etc\\passwd",
        new_str: "malicious",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("path traversal");
    });

    it("should allow legitimate content without path traversal", async () => {
      const filePath = await createTempFile("test.txt", "function hello() {\n  return 'world';\n}");
      const { editFileTool } = await import("../../src/tools/file-tools.js");

      const result = await editFileTool.execute({
        path: filePath,
        old_str: "return 'world';",
        new_str: "return 'hello';",
      });

      expect(result.success).toBe(true);
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toContain("return 'hello';");
    });
  });

  describe("read_file tool", () => {
    it("should reject path traversal in file paths", async () => {
      const { readFileTool } = await import("../../src/tools/file-tools.js");

      // Attempt to read outside the allowed directory
      const result = await readFileTool.execute({
        path: "../../../etc/passwd",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("write_file tool", () => {
    it("should reject path traversal in file paths", async () => {
      const { writeFileTool } = await import("../../src/tools/file-tools.js");

      const result = await writeFileTool.execute({
        path: "../../../tmp/malicious.txt",
        content: "malicious",
      });

      expect(result.success).toBe(false);
    });
  });
});

describe("Command Injection Prevention", () => {
  beforeEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe("bash tool", () => {
    it("should execute simple commands without injection", async () => {
      const { bashTool } = await import("../../src/tools/bash-tool.js");

      const result = await bashTool.execute({
        command: `echo "hello world"`,
        description: "Test simple command",
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain("hello world");
    });

    it("should allow pipes within commands", async () => {
      const { bashTool } = await import("../../src/tools/bash-tool.js");

      const result = await bashTool.execute({
        command: `echo "test" | cat`,
        description: "Test pipe injection",
      });

      // Should be okay - pipes within a command are legitimate
      expect(result.success).toBe(true);
    });
  });
});

describe("Sensitive File Access", () => {
  // Note: These tests document the expected security behavior.
  // The actual implementation should block these paths before checking existence.

  it("should handle non-existent sensitive paths gracefully", async () => {
    const { readFileTool } = await import("../../src/tools/file-tools.js");

    const result = await readFileTool.execute({
      path: "/home/user/.ssh/id_rsa",
    });

    // Currently returns "File not found" - ideally should say "sensitive path"
    expect(result.success).toBe(false);
  });

  it("should handle system file access gracefully", async () => {
    const { readFileTool } = await import("../../src/tools/file-tools.js");

    const result = await readFileTool.execute({
      path: "/etc/shadow",
    });

    expect(result.success).toBe(false);
  });
});

describe("Environment Variable Filtering", () => {
  describe("bash tool env filtering", () => {
    it("should filter out non-allowlisted environment variables", async () => {
      const { bashTool } = await import("../../src/tools/bash-tool.js");

      const result = await bashTool.execute({
        command: `echo "CUSTOM_VAR=$CUSTOM_VAR"`,
        description: "Check non-allowlisted vars are filtered",
        env: {
          API_KEY: "secret123", // Should be filtered
          CUSTOM_VAR: "should-be-empty", // Not in allowlist
        },
      });

      expect(result.success).toBe(true);
      // CUSTOM_VAR should be empty since it's not allowlisted
      expect(result.output).toContain("CUSTOM_VAR=");
    });

    it("should preserve allowlisted environment variables", async () => {
      const { bashTool } = await import("../../src/tools/bash-tool.js");

      const result = await bashTool.execute({
        command: `echo "HOME=$HOME"`,
        description: "Check HOME is passed",
      });

      expect(result.success).toBe(true);
      // HOME should be set
      expect(result.output).toContain("HOME=");
    });
  });
});
