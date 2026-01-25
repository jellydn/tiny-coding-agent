import { accessSync, constants } from "node:fs";
import { join } from "node:path";

/**
 * Check if a command is available in PATH.
 */
export function isCommandAvailable(command: string): boolean {
	// Reject commands with potentially dangerous characters
	if (/[^a-zA-Z0-9_\-.]/.test(command)) return false;

	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (!dir) continue;
		try {
			accessSync(join(dir, command), constants.X_OK);
			return true;
		} catch {
			// continue searching
		}
	}
	return false;
}
