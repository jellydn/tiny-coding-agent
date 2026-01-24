import { describe, it, expect } from "bun:test";
import { fuzzyMatch, parseChatCommand, COMMANDS } from "../src/chat-commands.js";

describe("fuzzyMatch()", () => {
  it("should return true for exact matches", () => {
    expect(fuzzyMatch("/model", "/model")).toBe(true);
    expect(fuzzyMatch("hello", "hello")).toBe(true);
  });

  it("should be case-insensitive", () => {
    expect(fuzzyMatch("/Model", "/model")).toBe(true);
    expect(fuzzyMatch("/MODEL", "/model")).toBe(true);
    expect(fuzzyMatch("Hello", "hello")).toBe(true);
  });

  it("should return true for prefix matches", () => {
    expect(fuzzyMatch("/mod", "/model")).toBe(true);
    expect(fuzzyMatch("/model", "/mod")).toBe(true);
  });

  it("should trim whitespace", () => {
    expect(fuzzyMatch("  /model  ", "/model")).toBe(true);
    expect(fuzzyMatch("/model", "  /model  ")).toBe(true);
  });

  it("should return true for fuzzy matches above threshold", () => {
    expect(fuzzyMatch("/mdel", "/model")).toBe(true);
    // "/thnk" is too far from "/thinking" for 0.7 threshold
    expect(fuzzyMatch("/thinkng", "/thinking")).toBe(true);
    expect(fuzzyMatch("/effrt", "/effort")).toBe(true);
  });

  it("should return false for fuzzy matches below threshold", () => {
    expect(fuzzyMatch("/xyz", "/model")).toBe(false);
    expect(fuzzyMatch("abc", "xyz")).toBe(false);
  });

  it("should handle empty strings", () => {
    expect(fuzzyMatch("", "")).toBe(true);
    // "" is a prefix of "model", so it returns true
    expect(fuzzyMatch("", "model")).toBe(true);
  });

  it("should use custom threshold", () => {
    expect(fuzzyMatch("/mdl", "/model", 0.5)).toBe(true);
    expect(fuzzyMatch("/mdl", "/model", 0.9)).toBe(false);
  });
});

describe("parseChatCommand()", () => {
  describe("/model command", () => {
    it("should parse exact /model command", () => {
      const result = parseChatCommand("/model claude-3-5-sonnet");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.model).toBe("claude-3-5-sonnet");
      expect(result.matchedCommand).toBe(COMMANDS.MODEL);
      expect(result.error).toBeUndefined();
    });

    it("should parse fuzzy /model command", () => {
      const result = parseChatCommand("/mdel gpt-4");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.model).toBe("gpt-4");
    });

    it("should handle model names with spaces", () => {
      const result = parseChatCommand("/model claude 3.5 sonnet");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.model).toBe("claude 3.5 sonnet");
    });

    it("should require model argument", () => {
      const result = parseChatCommand("/model");
      expect(result.isCommand).toBe(false);
      expect(result.newState).toBeUndefined();
    });
  });

  describe("/thinking command", () => {
    it("should parse /thinking on", () => {
      const result = parseChatCommand("/thinking on");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.enabled).toBe(true);
      expect(result.matchedCommand).toBe(COMMANDS.THINKING);
      expect(result.error).toBeUndefined();
    });

    it("should parse /thinking true", () => {
      const result = parseChatCommand("/thinking true");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.enabled).toBe(true);
    });

    it("should parse /thinking enable", () => {
      const result = parseChatCommand("/thinking enable");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.enabled).toBe(true);
    });

    it("should parse /thinking off", () => {
      const result = parseChatCommand("/thinking off");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.enabled).toBe(false);
    });

    it("should parse /thinking false", () => {
      const result = parseChatCommand("/thinking false");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.enabled).toBe(false);
    });

    it("should parse /thinking disable", () => {
      const result = parseChatCommand("/thinking disable");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.enabled).toBe(false);
    });

    it("should return error for invalid state", () => {
      const result = parseChatCommand("/thinking invalid");
      expect(result.isCommand).toBe(true);
      expect(result.error).toBe("Invalid thinking state: invalid. Use: on/off");
      expect(result.newState).toBeUndefined();
    });

    it("should handle missing state argument", () => {
      const result = parseChatCommand("/thinking");
      expect(result.isCommand).toBe(true);
      expect(result.error).toBe("Invalid thinking state: . Use: on/off");
    });

    it("should parse fuzzy /thinking command", () => {
      const result = parseChatCommand("/thinkng on");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.enabled).toBe(true);
    });
  });

  describe("/effort command", () => {
    it("should parse /effort low", () => {
      const result = parseChatCommand("/effort low");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.enabled).toBe(true);
      expect(result.newState?.thinking?.effort).toBe("low");
      expect(result.matchedCommand).toBe(COMMANDS.EFFORT);
      expect(result.error).toBeUndefined();
    });

    it("should parse /effort medium", () => {
      const result = parseChatCommand("/effort medium");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.effort).toBe("medium");
    });

    it("should parse /effort high", () => {
      const result = parseChatCommand("/effort high");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.effort).toBe("high");
    });

    it("should require effort argument", () => {
      const result = parseChatCommand("/effort");
      expect(result.isCommand).toBe(false);
      expect(result.newState).toBeUndefined();
    });

    it("should return error for invalid effort", () => {
      const result = parseChatCommand("/effort invalid");
      expect(result.isCommand).toBe(true);
      expect(result.error).toBe("Invalid effort level: invalid. Use: low/medium/high");
      expect(result.newState).toBeUndefined();
    });

    it("should parse fuzzy /effort command", () => {
      const result = parseChatCommand("/effrt high");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.thinking?.effort).toBe("high");
    });
  });

  describe("non-commands", () => {
    it("should return isCommand: false for regular text", () => {
      const result = parseChatCommand("Hello, how are you?");
      expect(result.isCommand).toBe(false);
      expect(result.newState).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it("should return isCommand: false for unrecognized command", () => {
      const result = parseChatCommand("/unknown command");
      expect(result.isCommand).toBe(false);
    });

    it("should handle empty input", () => {
      const result = parseChatCommand("");
      // Empty string prefix matches any command, so it returns true with error
      expect(result.isCommand).toBe(true);
      expect(result.error).toBeDefined();
    });

    it("should handle whitespace only input", () => {
      const result = parseChatCommand("   ");
      // Whitespace becomes empty after trim, prefix matches any command
      expect(result.isCommand).toBe(true);
      expect(result.error).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should be case-insensitive for commands", () => {
      const result = parseChatCommand("/MODEL claude");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.model).toBe("claude");
    });

    it("should trim leading/trailing whitespace", () => {
      const result = parseChatCommand("  /model claude  ");
      expect(result.isCommand).toBe(true);
      expect(result.newState?.model).toBe("claude");
    });

    it("should handle multiple spaces between arguments", () => {
      const result = parseChatCommand("/model   claude   3.5");
      expect(result.isCommand).toBe(true);
      // split(/\s+/) collapses multiple spaces, so we get single spaces
      expect(result.newState?.model).toBe("claude 3.5");
    });
  });
});
