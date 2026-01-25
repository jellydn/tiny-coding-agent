import { describe, it, expect } from "bun:test";
import { isLooping, redactApiKey, truncateOutput, isValidToolCall, checkAborted } from "./agent.js";

describe("agent.ts helper functions", () => {
  describe("isLooping", () => {
    it("should return false for fewer than 3 tool calls", () => {
      expect(isLooping(["tool:a"])).toBe(false);
      expect(isLooping(["tool:a", "tool:b"])).toBe(false);
    });

    it("should detect when the same tool is called 3 times in a row", () => {
      const calls = ["readFile:{}", "readFile:{}", "readFile:{}", "readFile:{}"];
      expect(isLooping(calls)).toBe(true);
    });

    it("should detect when same tool is called 5 times in last 5 calls", () => {
      const calls = ["readFile:{}", "writeFile:{}", "readFile:{}", "readFile:{}", "readFile:{}"];
      expect(isLooping(calls)).toBe(true);
    });

    it("should detect rapid repetition (8+ calls of same tool in last 10)", () => {
      const calls = [
        "readFile:{}",
        "readFile:{}",
        "readFile:{}",
        "readFile:{}",
        "readFile:{}",
        "readFile:{}",
        "readFile:{}",
        "readFile:{}",
        "writeFile:{}",
        "other:{}",
      ];
      expect(isLooping(calls)).toBe(true);
    });

    it("should return false for varied tool calls", () => {
      const calls = ["readFile:{}", "writeFile:{}", "grep:{}", "bash:{}", "readFile:{}"];
      expect(isLooping(calls)).toBe(false);
    });
  });

  describe("redactApiKey", () => {
    it("should return '(not set)' for undefined key", () => {
      expect(redactApiKey(undefined)).toBe("(not set)");
    });

    it("should return '(not set)' for undefined key", () => {
      expect(redactApiKey(undefined)).toBe("(not set)");
    });

    it("should return '****' for short keys (8 chars or less)", () => {
      expect(redactApiKey("short")).toBe("****");
      expect(redactApiKey("12345678")).toBe("****");
    });

    it("should redact long keys showing first 4 chars", () => {
      const key = "sk-1234567890abcdef";
      expect(redactApiKey(key)).toBe("sk-1...REDACTED");
    });

    it("should handle very long keys", () => {
      const key = "sk-" + "a".repeat(100);
      expect(redactApiKey(key)).toBe("sk-a...REDACTED");
    });
  });

  describe("truncateOutput", () => {
    it("should return undefined for undefined input", () => {
      expect(truncateOutput(undefined)).toBeUndefined();
    });

    it("should return empty string for empty string input", () => {
      expect(truncateOutput("")).toBe("");
    });

    it("should not truncate short output", () => {
      expect(truncateOutput("short text")).toBe("short text");
    });

    it("should truncate long output (>500 chars)", () => {
      const longOutput = "a".repeat(600);
      const result = truncateOutput(longOutput);
      expect(result).toContain("... (");
      expect(result?.endsWith("more chars)")).toBe(true);
    });

    it("should truncate output with many lines (>10 lines)", () => {
      const multiline = Array(15).fill("line").join("\n");
      const result = truncateOutput(multiline);
      expect(result).toContain("... (");
      expect(result?.endsWith("more lines)")).toBe(true);
    });

    it("should truncate based on lines first before char limit", () => {
      // 15 lines of 100 chars each - more than 10 lines should trigger line truncation
      const output = Array(15).fill("a".repeat(100)).join("\n");
      const result = truncateOutput(output);
      expect(result).toContain("... (");
      expect(result?.endsWith("more lines)")).toBe(true);
    });
  });

  describe("isValidToolCall", () => {
    it("should return false for non-JSON text", () => {
      expect(isValidToolCall("hello")).toBe(false);
      expect(isValidToolCall("not a tool call")).toBe(false);
    });

    it("should return false for JSON without name property", () => {
      expect(isValidToolCall('{"args": {}}')).toBe(false);
      expect(isValidToolCall('{"name": 123}')).toBe(false);
    });

    it("should return true for JSON with string name property", () => {
      expect(isValidToolCall('{"name": "readFile"}')).toBe(true);
      expect(isValidToolCall('{"name": "bash", "args": {}}')).toBe(true);
    });

    it("should return false for invalid JSON", () => {
      expect(isValidToolCall("{invalid json}")).toBe(false);
      expect(isValidToolCall("")).toBe(false);
    });
  });

  describe("checkAborted", () => {
    it("should not throw for undefined signal", () => {
      expect(() => checkAborted(undefined)).not.toThrow();
    });

    it("should not throw for non-aborted signal", () => {
      const signal = { aborted: false } as AbortSignal;
      expect(() => checkAborted(signal)).not.toThrow();
    });

    it("should throw AbortError for aborted signal", () => {
      const signal = { aborted: true } as AbortSignal;
      expect(() => checkAborted(signal)).toThrow(DOMException);
      expect(() => checkAborted(signal)).toThrow("Aborted");
    });
  });
});
