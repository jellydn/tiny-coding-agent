import { describe, it, expect } from "bun:test";
import { writeFileTool } from "@/tools/file-tools.js";

describe("write_file security", () => {
  it("should reject paths with .. for directory traversal", async () => {
    const result = await writeFileTool.execute({
      path: "../../../etc/passwd",
      content: "malicious",
    });
    expect(result.success).toBe(false);
    // Either blocks because of .. or because it resolves to a system path
    expect(result.error).toMatch(/(\.\.|system path)/);
  });

  it("should reject paths with embedded .. that resolve to system paths", async () => {
    const result = await writeFileTool.execute({
      path: "/tmp/../../../etc/passwd",
      content: "malicious",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/(system path|sensitive)/);
  });

  it("should reject writes to /etc directory", async () => {
    const result = await writeFileTool.execute({
      path: "/etc/malicious.conf",
      content: "malicious",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("system path");
  });

  it("should reject writes to /usr directory", async () => {
    const result = await writeFileTool.execute({
      path: "/usr/local/bin/test",
      content: "content",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("system path");
  });

  it("should reject writes to /root directory", async () => {
    const result = await writeFileTool.execute({
      path: "/root/test.txt",
      content: "content",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("system path");
  });

  it("should reject writes to .env files", async () => {
    const result = await writeFileTool.execute({
      path: "/tmp/test/.env",
      content: "API_KEY=secret",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("sensitive");
  });

  it("should reject writes to .aws/credentials", async () => {
    const result = await writeFileTool.execute({
      path: "/home/user/.aws/credentials",
      content: "[default]",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("sensitive");
  });

  it("should reject writes to .ssh directory", async () => {
    const result = await writeFileTool.execute({
      path: "/home/user/.ssh/config",
      content: "Host *",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("sensitive");
  });

  it("should allow writes to safe paths", async () => {
    const result = await writeFileTool.execute({
      path: "/tmp/test-file.txt",
      content: "safe content",
    });
    expect(result.success).toBe(true);
    // Clean up
    await import("node:fs/promises").then((fs) =>
      fs.rm("/tmp/test-file.txt", { force: true }).catch(() => {}),
    );
  });

  it("should allow writes to relative paths without ..", async () => {
    const result = await writeFileTool.execute({
      path: "src/test.txt",
      content: "safe content",
    });
    expect(result.success).toBe(true);
    // Clean up
    await import("node:fs/promises").then((fs) =>
      fs.rm("src/test.txt", { force: true }).catch(() => {}),
    );
  });
});
