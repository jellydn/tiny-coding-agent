import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolResult } from "./types.js";

const SENSITIVE_PATTERNS = [
	/\.env$/,
	/\.env\.(?!example|sample|template|default)([a-zA-Z0-9_-]+)$/,
	/\.aws\/credentials$/,
	/\.aws\/config$/,
	/\.ssh\//,
	/\.npmrc$/,
	/\.git-credentials$/,
	/\.gitconfig$/,
	/\/etc\/passwd$/,
	/\/etc\/shadow$/,
	/\.pki\//,
	/\.gnupg\//,
];

export function isSensitiveFile(filePath: string): boolean {
	const basename = path.basename(filePath);
	return SENSITIVE_PATTERNS.some((pattern) => pattern.test(filePath) || pattern.test(basename));
}

export function handleFileError(filePath: string, err: unknown, context: string): ToolResult {
	const error = err as NodeJS.ErrnoException;
	if (error.code === "ENOENT") {
		return { success: false, error: `File not found: ${filePath}` };
	}
	if (error.code === "EACCES") {
		return { success: false, error: `Permission denied: ${filePath}` };
	}
	return { success: false, error: `${context}: ${error.message}` };
}

export function handleDirError(dirPath: string, err: unknown): ToolResult {
	const error = err as NodeJS.ErrnoException;
	if (error.code === "ENOENT") {
		return { success: false, error: `Directory not found: ${dirPath}` };
	}
	if (error.code === "EACCES") {
		return { success: false, error: `Permission denied: ${dirPath}` };
	}
	if (error.code === "ENOTDIR") {
		return { success: false, error: `Not a directory: ${dirPath}` };
	}
	return { success: false, error: `Failed to list directory: ${error.message}` };
}

interface PathValidationResult {
	valid: boolean;
	error?: string;
}

function isSensitiveSystemPath(resolved: string): string | undefined {
	const sensitivePaths = ["/etc/", "/usr/", "/bin/", "/sbin/", "/sys/", "/proc/", "/dev/", "/root/"];
	for (const sensitive of sensitivePaths) {
		if (resolved.startsWith(sensitive)) {
			return sensitive;
		}
	}
	return undefined;
}

function isSensitiveHomePath(resolved: string): string | undefined {
	const homeDir = process.env.HOME ?? "";
	const homeSensitivePaths = [
		path.join(homeDir, ".ssh"),
		path.join(homeDir, ".aws"),
		path.join(homeDir, ".gnupg"),
		path.join(homeDir, ".pki"),
	];
	for (const sensitive of homeSensitivePaths) {
		if (resolved.startsWith(sensitive)) {
			return sensitive;
		}
	}
	return undefined;
}

export async function validatePath(filePath: string, checkSymlink: boolean = false): Promise<PathValidationResult> {
	const normalized = path.normalize(filePath);
	if (normalized.includes("..")) {
		return { valid: false, error: 'Path cannot contain ".." for security reasons' };
	}

	const resolved = path.resolve(filePath);

	const systemPath = isSensitiveSystemPath(resolved);
	if (systemPath) {
		return { valid: false, error: `Cannot write to system path: ${systemPath}` };
	}

	const homePath = isSensitiveHomePath(resolved);
	if (homePath) {
		return {
			valid: false,
			error: `Cannot write to sensitive directory: ${path.basename(homePath)}`,
		};
	}

	if (checkSymlink) {
		try {
			const stats = await fs.lstat(resolved);
			if (stats.isSymbolicLink()) {
				const linkTarget = await fs.readlink(resolved);
				const target = path.resolve(path.dirname(resolved), linkTarget);
				const targetSystem = isSensitiveSystemPath(target);
				const targetHome = isSensitiveHomePath(target);
				if (targetSystem || targetHome || target.includes("..")) {
					return { valid: false, error: "Symlink points to restricted location" };
				}
			}
		} catch {
			// File doesn't exist yet, skip symlink check
		}
	}

	return { valid: true };
}

export function validateEditString(str: string): PathValidationResult {
	const pathTraversalPattern = /\.\.[\\/]/;
	if (pathTraversalPattern.test(str)) {
		return { valid: false, error: "Edit strings must not contain path traversal sequences" };
	}
	return { valid: true };
}
