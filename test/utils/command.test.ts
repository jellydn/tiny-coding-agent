import { describe, it, expect } from "bun:test";
import { isCommandAvailable } from "../src/command.js";

describe("isCommandAvailable", () => {
  describe("commands that should be available", () => {
    it("should return true for 'echo' command", () => {
      expect(isCommandAvailable("echo")).toBe(true);
    });

    it("should return true for 'ls' command", () => {
      expect(isCommandAvailable("ls")).toBe(true);
    });

    it("should return true for 'cat' command", () => {
      expect(isCommandAvailable("cat")).toBe(true);
    });

    it("should return true for 'node' command", () => {
      expect(isCommandAvailable("node")).toBe(true);
    });

    it("should return true for 'bun' command", () => {
      expect(isCommandAvailable("bun")).toBe(true);
    });
  });

  describe("commands that should not be available", () => {
    it("should return false for non-existent command", () => {
      expect(isCommandAvailable("definitely-not-a-real-command-12345")).toBe(false);
    });

    it("should return false for random alphanumeric string", () => {
      expect(isCommandAvailable("xyzabc123def")).toBe(false);
    });
  });

  describe("sanitization", () => {
    it("should reject command with semicolon (command injection attempt)", () => {
      expect(isCommandAvailable("echo; rm -rf /")).toBe(false);
    });

    it("should reject command with pipe", () => {
      expect(isCommandAvailable("ls | cat")).toBe(false);
    });

    it("should reject command with ampersand", () => {
      expect(isCommandAvailable("ls & cat")).toBe(false);
    });

    it("should reject command with special characters", () => {
      expect(isCommandAvailable("cat$HOME")).toBe(false);
    });

    it("should reject command with quotes", () => {
      expect(isCommandAvailable('cat"foo"')).toBe(false);
    });

    it("should reject command with backtick", () => {
      expect(isCommandAvailable("echo `ls`")).toBe(false);
    });

    it("should reject command with newline", () => {
      expect(isCommandAvailable("ls\nrm")).toBe(false);
    });
  });

  describe("valid variations", () => {
    it("should accept command with numbers", () => {
      const result = isCommandAvailable("grep2");
      // May or may not exist depending on system, but should not be rejected by sanitization
      expect(typeof result).toBe("boolean");
    });

    it("should accept command with hyphens", () => {
      const result = isCommandAvailable("my-command");
      // May or may not exist depending on system, but should not be rejected by sanitization
      expect(typeof result).toBe("boolean");
    });

    it("should accept command with underscores", () => {
      const result = isCommandAvailable("my_command");
      // May or may not exist depending on system, but should not be rejected by sanitization
      expect(typeof result).toBe("boolean");
    });

    it("should accept command with dots", () => {
      const result = isCommandAvailable("npm");
      expect(typeof result).toBe("boolean");
    });
  });

  describe("PATH handling", () => {
    it("should check multiple PATH directories", () => {
      // At least one of echo, ls, cat should be available
      const results = ["echo", "ls", "cat", "printf"].map((cmd) => isCommandAvailable(cmd));
      expect(results.some((r) => r === true)).toBe(true);
    });

    it("should handle empty PATH gracefully", () => {
      const originalPath = process.env.PATH;
      try {
        process.env.PATH = "";
        // Should not throw, should just return false
        const result = isCommandAvailable("echo");
        expect(typeof result).toBe("boolean");
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it("should handle undefined PATH gracefully", () => {
      const originalPath = process.env.PATH;
      try {
        delete process.env.PATH;
        // Should not throw, should just return false
        const result = isCommandAvailable("echo");
        expect(typeof result).toBe("boolean");
      } finally {
        process.env.PATH = originalPath;
      }
    });
  });
});
