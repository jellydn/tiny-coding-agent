import { describe, it, expect } from "bun:test";
import { handleFileError, handleDirError } from "./file-tools.js";

describe("handleFileError()", () => {
  it("should return file not found error for ENOENT", () => {
    const err = { code: "ENOENT", message: "enoent" } as NodeJS.ErrnoException;
    const result = handleFileError("/path/to/file.txt", err, "Failed to read file");
    expect(result.success).toBe(false);
    expect(result.error).toBe("File not found: /path/to/file.txt");
  });

  it("should return permission denied error for EACCES", () => {
    const err = { code: "EACCES", message: "eacces" } as NodeJS.ErrnoException;
    const result = handleFileError("/path/to/file.txt", err, "Failed to read file");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission denied: /path/to/file.txt");
  });

  it("should return generic error for other codes", () => {
    const err = { code: "OTHER", message: "some error" } as NodeJS.ErrnoException;
    const result = handleFileError("/path/to/file.txt", err, "Failed to read file");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to read file: some error");
  });
});

describe("handleDirError()", () => {
  it("should return directory not found error for ENOENT", () => {
    const err = { code: "ENOENT", message: "enoent" } as NodeJS.ErrnoException;
    const result = handleDirError("/path/to/dir", err);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Directory not found: /path/to/dir");
  });

  it("should return permission denied error for EACCES", () => {
    const err = { code: "EACCES", message: "eacces" } as NodeJS.ErrnoException;
    const result = handleDirError("/path/to/dir", err);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission denied: /path/to/dir");
  });

  it("should return not a directory error for ENOTDIR", () => {
    const err = { code: "ENOTDIR", message: "enotdir" } as NodeJS.ErrnoException;
    const result = handleDirError("/path/to/dir", err);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Not a directory: /path/to/dir");
  });

  it("should return generic error for other codes", () => {
    const err = { code: "OTHER", message: "some error" } as NodeJS.ErrnoException;
    const result = handleDirError("/path/to/dir", err);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to list directory: some error");
  });
});
