import { describe, it, expect } from "bun:test";
import { handleFileError, handleDirError, isSensitiveFile } from "../../src/tools/file-tools.js";

describe("isSensitiveFile()", () => {
  describe("sensitive files", () => {
    it("should detect .env files", () => {
      expect(isSensitiveFile("/path/to/.env")).toBe(true);
      expect(isSensitiveFile("/home/user/.env")).toBe(true);
      expect(isSensitiveFile(".env")).toBe(true);
    });

    it("should detect .env.* files", () => {
      expect(isSensitiveFile("/path/to/.env.local")).toBe(true);
      expect(isSensitiveFile("/path/to/.env.production")).toBe(true);
      expect(isSensitiveFile("/path/to/.env.development")).toBe(true);
    });

    it("should detect AWS credentials", () => {
      expect(isSensitiveFile("/home/user/.aws/credentials")).toBe(true);
      expect(isSensitiveFile("/home/user/.aws/config")).toBe(true);
    });

    it("should detect SSH files", () => {
      expect(isSensitiveFile("/home/user/.ssh/id_rsa")).toBe(true);
      expect(isSensitiveFile("/home/user/.ssh/id_ed25519")).toBe(true);
      expect(isSensitiveFile("/home/user/.ssh/known_hosts")).toBe(true);
      expect(isSensitiveFile("/home/user/.ssh/config")).toBe(true);
    });

    it("should detect npmrc", () => {
      expect(isSensitiveFile("/home/user/.npmrc")).toBe(true);
      expect(isSensitiveFile(".npmrc")).toBe(true);
    });

    it("should detect git credentials", () => {
      expect(isSensitiveFile("/home/user/.git-credentials")).toBe(true);
      expect(isSensitiveFile("/home/user/.gitconfig")).toBe(true);
    });

    it("should detect system sensitive files", () => {
      expect(isSensitiveFile("/etc/passwd")).toBe(true);
      expect(isSensitiveFile("/etc/shadow")).toBe(true);
    });

    it("should detect PKI and GPG files", () => {
      expect(isSensitiveFile("/home/user/.pki/cert.pem")).toBe(true);
      expect(isSensitiveFile("/home/user/.gnupg/secring.gpg")).toBe(true);
    });
  });

  describe("safe files", () => {
    it("should allow regular source files", () => {
      expect(isSensitiveFile("/path/to/main.ts")).toBe(false);
      expect(isSensitiveFile("/path/to/index.ts")).toBe(false);
      expect(isSensitiveFile("/path/to/package.json")).toBe(false);
    });

    it("should allow README and config files", () => {
      expect(isSensitiveFile("/path/to/README.md")).toBe(false);
      expect(isSensitiveFile("/path/to/tsconfig.json")).toBe(false);
    });

    it("should allow files that start with env", () => {
      expect(isSensitiveFile("/path/to/env.ts")).toBe(false);
      expect(isSensitiveFile("/path/to/environment.ts")).toBe(false);
    });

    it("should allow .envexample (template file)", () => {
      expect(isSensitiveFile("/path/to/.env.example")).toBe(false);
      expect(isSensitiveFile("/path/to/.env.sample")).toBe(false);
    });
  });
});

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
