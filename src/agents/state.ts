import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StateFile } from "./types.js";

const MAX_STATE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ARCHIVE_COUNT = 5;
const LOCK_FILE_SUFFIX = ".lock";

export interface ReadStateOptions {
	ignoreMissing?: boolean;
}

export interface WriteStateOptions {
	forceWrite?: boolean;
}

export interface StateResult<T> {
	success: boolean;
	data?: T;
	error?: string;
}

export async function readStateFile(
	stateFilePath: string,
	_options?: ReadStateOptions
): Promise<StateResult<StateFile>> {
	const lockPath = stateFilePath + LOCK_FILE_SUFFIX;

	try {
		await acquireLock(lockPath);
	} catch (lockError) {
		return { success: false, error: `Failed to acquire lock: ${(lockError as Error).message}` };
	}

	try {
		try {
			await fs.access(stateFilePath);
		} catch {
			return { success: false, error: `State file not found: ${stateFilePath}` };
		}

		const content = await fs.readFile(stateFilePath, "utf-8");
		let data: unknown;
		try {
			data = JSON.parse(content);
		} catch {
			return { success: false, error: `Invalid JSON in state file: ${stateFilePath}` };
		}

		if (!isValidStateFile(data)) {
			return { success: false, error: `Invalid state file format: ${stateFilePath}` };
		}

		return { success: true, data: data as StateFile };
	} catch (err) {
		return { success: false, error: `Failed to read state file: ${(err as Error).message}` };
	} finally {
		await releaseLock(lockPath);
	}
}

export async function writeStateFile(
	stateFilePath: string,
	state: StateFile,
	options?: WriteStateOptions
): Promise<StateResult<void>> {
	const lockPath = stateFilePath + LOCK_FILE_SUFFIX;
	const tempPath = `${stateFilePath}.tmp.${Math.random().toString(36).slice(2, 11)}`;

	try {
		await acquireLock(lockPath);
	} catch (lockError) {
		return { success: false, error: `Failed to acquire lock: ${(lockError as Error).message}` };
	}

	try {
		const content = JSON.stringify(state, null, 2);

		try {
			const stats = await fs.stat(stateFilePath);
			if (stats.size > MAX_STATE_FILE_SIZE && !options?.forceWrite) {
				await rotateStateFiles(stateFilePath);
			}
		} catch {
			// File doesn't exist yet, that's fine
		}

		await fs.writeFile(tempPath, content, "utf-8");
		await fs.rename(tempPath, stateFilePath);

		return { success: true };
	} catch (err) {
		try {
			await fs.unlink(tempPath).catch(() => {});
		} catch {
			// Ignore cleanup errors
		}
		return { success: false, error: `Failed to write state file: ${(err as Error).message}` };
	} finally {
		await releaseLock(lockPath);
	}
}

async function acquireLock(lockPath: string): Promise<void> {
	const maxRetries = 50;
	const retryDelay = 50;

	for (let i = 0; i < maxRetries; i++) {
		try {
			const fd = await fs.open(lockPath, "wx");
			await fd.write(String(process.pid));
			await fd.close();
			return;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EEXIST") {
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
				continue;
			}
			throw err;
		}
	}
	throw new Error("Failed to acquire lock after maximum retries");
}

async function releaseLock(lockPath: string): Promise<void> {
	try {
		await fs.unlink(lockPath);
	} catch {
		// Lock file may not exist if process crashed, ignore
	}
}

async function rotateStateFiles(stateFilePath: string): Promise<void> {
	const dir = path.dirname(stateFilePath);
	const baseName = path.basename(stateFilePath);

	for (let i = MAX_ARCHIVE_COUNT; i >= 1; i--) {
		const oldPath = i === 1 ? stateFilePath : path.join(dir, `${baseName}.${i - 1}`);
		const newPath = path.join(dir, `${baseName}.${i}`);

		try {
			await fs.rename(oldPath, newPath);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err;
			}
		}
	}
}

function isValidStateFile(data: unknown): data is StateFile {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return false;
	}

	const state = data as Record<string, unknown>;

	if (
		typeof state.metadata !== "object" ||
		state.metadata === null ||
		typeof (state.metadata as Record<string, unknown>).agentName !== "string" ||
		typeof (state.metadata as Record<string, unknown>).agentVersion !== "string" ||
		typeof (state.metadata as Record<string, unknown>).invocationTimestamp !== "string" ||
		typeof (state.metadata as Record<string, unknown>).parameters !== "object"
	) {
		return false;
	}

	if (typeof state.phase !== "string" || !["plan", "build", "explore"].includes(state.phase as string)) {
		return false;
	}

	if (
		typeof state.taskDescription !== "string" ||
		typeof state.status !== "string" ||
		!["pending", "in_progress", "completed", "failed"].includes(state.status as string)
	) {
		return false;
	}

	if (!Array.isArray(state.errors)) {
		return false;
	}

	if (!Array.isArray(state.artifacts)) {
		return false;
	}

	return true;
}
