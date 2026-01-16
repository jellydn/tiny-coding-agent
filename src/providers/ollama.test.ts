import { describe, it, expect } from "bun:test";
import { toErrorMessage } from "./ollama.js";

describe("toErrorMessage()", () => {
  it("should return error message for Error instances", () => {
    const err = new Error("test error message");
    expect(toErrorMessage(err)).toBe("test error message");
  });

  it("should return string for string input", () => {
    expect(toErrorMessage("simple error")).toBe("simple error");
  });

  it("should return string representation for numbers", () => {
    expect(toErrorMessage(404)).toBe("404");
  });

  it("should return string representation for objects", () => {
    const obj = { code: "ENOENT", message: "file not found" };
    expect(toErrorMessage(obj)).toBe("[object Object]");
  });

  it("should handle null", () => {
    expect(toErrorMessage(null)).toBe("null");
  });

  it("should handle undefined", () => {
    expect(toErrorMessage(undefined)).toBe("undefined");
  });
});
