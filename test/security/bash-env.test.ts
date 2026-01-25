import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { bashTool } from "../../src/tools/bash-tool.js";

describe("bash tool environment filtering", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set test environment variables
    process.env.TEST_SAFE_VAR = "safe_value";
    process.env.API_KEY = "secret_key";
    process.env.MY_SECRET = "my_secret_value";
    process.env.AWS_ACCESS_KEY_ID = "aws_key";
    process.env.OPENAI_API_KEY = "openai_key";
    process.env.ANTHROPIC_API_KEY = "anthropic_key";
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  it("should filter out API_KEY from spawned process", async () => {
    const result = await bashTool.execute({
      command: 'echo "$API_KEY"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    // Should be empty, not "secret_key"
    expect(result.output).not.toContain("secret_key");
  });

  it("should filter out MY_SECRET from spawned process", async () => {
    const result = await bashTool.execute({
      command: 'echo "$MY_SECRET"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain("my_secret_value");
  });

  it("should filter out AWS_ACCESS_KEY_ID from spawned process", async () => {
    const result = await bashTool.execute({
      command: 'echo "$AWS_ACCESS_KEY_ID"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain("aws_key");
  });

  it("should filter out OPENAI_API_KEY from spawned process", async () => {
    const result = await bashTool.execute({
      command: 'echo "$OPENAI_API_KEY"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain("openai_key");
  });

  it("should filter out ANTHROPIC_API_KEY from spawned process", async () => {
    const result = await bashTool.execute({
      command: 'echo "$ANTHROPIC_API_KEY"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain("anthropic_key");
  });

  it("should preserve PATH environment variable", async () => {
    const result = await bashTool.execute({
      command: 'echo "PATH is set: $PATH"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("PATH is set:");
  });

  it("should preserve HOME environment variable", async () => {
    const result = await bashTool.execute({
      command: 'echo "HOME is: $HOME"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("HOME is:");
  });

  it("should preserve USER environment variable", async () => {
    const result = await bashTool.execute({
      command: 'echo "USER is: $USER"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("USER is:");
  });

  it("should not pass through unknown custom environment variables", async () => {
    // TEST_SAFE_VAR is not in the SAFE_ENV_KEYS allowlist, so it should be filtered out
    process.env.TEST_SAFE_VAR = "safe_value";
    const result = await bashTool.execute({
      command: 'echo "VAR_IS_$TEST_SAFE_VAR"',
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    // The variable should be empty/undefined, so output should be "VAR_IS_"
    expect(result.output).toContain("VAR_IS_");
    expect(result.output).not.toContain("safe_value");
  });

  it("should handle env command without exposing sensitive vars", async () => {
    const result = await bashTool.execute({
      command: "env | grep -i key || true",
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    // Should not contain any of our sensitive keys
    expect(result.output).not.toContain("secret_key");
    expect(result.output).not.toContain("aws_key");
    expect(result.output).not.toContain("openai_key");
    expect(result.output).not.toContain("anthropic_key");
  });
});
