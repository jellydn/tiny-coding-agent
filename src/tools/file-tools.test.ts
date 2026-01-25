import { describe, expect, it } from "bun:test";
import { handleDirError, handleFileError, isSensitiveFile, validatePath } from "./file-tools.js";

describe("file-tools.ts helper functions", () => {
	describe("isSensitiveFile", () => {
		it("should return true for .env files (except examples)", () => {
			expect(isSensitiveFile("/path/.env")).toBe(true);
			expect(isSensitiveFile("/path/.env.local")).toBe(true);
			expect(isSensitiveFile("/path/.env.production")).toBe(true);
		});

		it("should return false for example/sample/template env files", () => {
			expect(isSensitiveFile("/path/.env.example")).toBe(false);
			expect(isSensitiveFile("/path/.env.sample")).toBe(false);
			expect(isSensitiveFile("/path/.env.template")).toBe(false);
			expect(isSensitiveFile("/path/.env.default")).toBe(false);
		});

		it("should return true for AWS credentials", () => {
			expect(isSensitiveFile("/home/user/.aws/credentials")).toBe(true);
			expect(isSensitiveFile("/home/user/.aws/config")).toBe(true);
		});

		it("should return true for SSH directory", () => {
			expect(isSensitiveFile("/home/user/.ssh/id_rsa")).toBe(true);
			expect(isSensitiveFile("/home/user/.ssh/known_hosts")).toBe(true);
			expect(isSensitiveFile("/home/user/.ssh/config")).toBe(true);
		});

		it("should return true for npmrc", () => {
			expect(isSensitiveFile("/home/user/.npmrc")).toBe(true);
		});

		it("should return true for git credentials", () => {
			expect(isSensitiveFile("/home/user/.git-credentials")).toBe(true);
			expect(isSensitiveFile("/home/user/.gitconfig")).toBe(true);
		});

		it("should return true for system password files", () => {
			expect(isSensitiveFile("/etc/passwd")).toBe(true);
			expect(isSensitiveFile("/etc/shadow")).toBe(true);
		});

		it("should return true for PKI and GPG directories", () => {
			expect(isSensitiveFile("/home/user/.pki/")).toBe(true);
			expect(isSensitiveFile("/home/user/.gnupg/secring.gpg")).toBe(true);
		});

		it("should return false for regular files", () => {
			expect(isSensitiveFile("/path/package.json")).toBe(false);
			expect(isSensitiveFile("/path/src/index.ts")).toBe(false);
			expect(isSensitiveFile("/path/README.md")).toBe(false);
		});
	});

	describe("validatePath", () => {
		it("should return valid for regular file paths", async () => {
			const result = await validatePath("/home/user/project/file.txt");
			expect(result.valid).toBe(true);
		});

		it("should return valid for relative paths", async () => {
			const result = await validatePath("./src/file.ts");
			expect(result.valid).toBe(true);
		});

		it("should reject paths with directory traversal", async () => {
			const result = await validatePath("../etc/passwd");
			expect(result.valid).toBe(false);
			expect(result.error).toContain('".."');
		});

		it("should reject absolute paths to system directories", async () => {
			const result1 = await validatePath("/etc/passwd");
			expect(result1.valid).toBe(false);
			expect(result1.error).toContain("system path");

			const result2 = await validatePath("/usr/bin/ls");
			expect(result2.valid).toBe(false);

			const result3 = await validatePath("/sys/kernel");
			expect(result3.valid).toBe(false);

			const result4 = await validatePath("/proc/1234");
			expect(result4.valid).toBe(false);

			const result5 = await validatePath("/dev/null");
			expect(result5.valid).toBe(false);

			const result6 = await validatePath("/root/.ssh");
			expect(result6.valid).toBe(false);
		});

		it("should reject paths resolving to sensitive home directories", async () => {
			const homeDir = process.env.HOME ?? "";
			if (homeDir) {
				const result = await validatePath(`${homeDir}/.ssh/id_rsa`);
				expect(result.valid).toBe(false);
				expect(result.error).toContain("sensitive directory");
			} else {
				const result = await validatePath("/home/user/.ssh/id_rsa");
				expect(result.valid).toBe(true);
			}
		});

		it("should reject paths with symlinks pointing to restricted locations", async () => {
			const homeDir = process.env.HOME ?? "";
			if (homeDir) {
				const result = await validatePath(`${homeDir}/.ssh/id_rsa`, true);
				expect(result.valid).toBe(false);
			}
		});
	});

	describe("handleFileError", () => {
		it("should return 'file not found' error for ENOENT", () => {
			const err = { code: "ENOENT", message: "ENOENT: no such file" } as NodeJS.ErrnoException;
			const result = handleFileError("/path/file.txt", err, "Failed to read file");
			expect(result.success).toBe(false);
			expect(result.error).toContain("File not found");
		});

		it("should return 'permission denied' error for EACCES", () => {
			const err = { code: "EACCES", message: "EACCES: permission denied" } as NodeJS.ErrnoException;
			const result = handleFileError("/path/file.txt", err, "Failed to read file");
			expect(result.success).toBe(false);
			expect(result.error).toContain("Permission denied");
		});

		it("should return generic error message for other errors", () => {
			const err = { code: "UNKNOWN", message: "Something went wrong" } as NodeJS.ErrnoException;
			const result = handleFileError("/path/file.txt", err, "Failed to read file");
			expect(result.success).toBe(false);
			expect(result.error).toContain("Failed to read file");
			expect(result.error).toContain("Something went wrong");
		});
	});

	describe("handleDirError", () => {
		it("should return 'directory not found' error for ENOENT", () => {
			const err = { code: "ENOENT", message: "ENOENT: no such file" } as NodeJS.ErrnoException;
			const result = handleDirError("/path/dir", err);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Directory not found");
		});

		it("should return 'permission denied' error for EACCES", () => {
			const err = { code: "EACCES", message: "EACCES: permission denied" } as NodeJS.ErrnoException;
			const result = handleDirError("/path/dir", err);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Permission denied");
		});

		it("should return 'not a directory' error for ENOTDIR", () => {
			const err = { code: "ENOTDIR", message: "ENOTDIR: not a directory" } as NodeJS.ErrnoException;
			const result = handleDirError("/path/notadir", err);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Not a directory");
		});

		it("should return generic error message for other errors", () => {
			const err = { code: "UNKNOWN", message: "Something went wrong" } as NodeJS.ErrnoException;
			const result = handleDirError("/path/dir", err);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Failed to list directory");
			expect(result.error).toContain("Something went wrong");
		});
	});
});
