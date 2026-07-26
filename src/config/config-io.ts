import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { CONFIG_DIR } from "./loader.js";

/**
 * Check if a config object contains any literal (non-env-var-reference) API
 * key. An `apiKey` value like `"sk-..."` is literal; `"${OPENAI_API_KEY}"`
 * is an env-var reference and does not count. Used to decide whether to
 * write the config file with owner-only (0o600) permissions.
 */
export function containsLiteralApiKey(config: Record<string, unknown>): boolean {
	const providers = config.providers;
	if (!providers || typeof providers !== "object") return false;

	for (const providerConfig of Object.values(providers as Record<string, unknown>)) {
		if (!providerConfig || typeof providerConfig !== "object") continue;
		const apiKey = (providerConfig as Record<string, unknown>).apiKey;
		if (typeof apiKey === "string" && apiKey.length > 0 && !apiKey.startsWith("${")) {
			return true;
		}
	}
	return false;
}

/**
 * Read a config file (YAML or JSON) as a raw object. Returns `{}` when the
 * file doesn't exist or can't be parsed. This is the single source of truth
 * for config-file reading — `login.ts` and `mcp.ts` both import it instead
 * of inlining their own copies.
 */
export async function readConfigFile(configPath: string): Promise<Record<string, unknown>> {
	if (!existsSync(configPath)) return {};
	const content = await readFile(configPath, "utf-8");

	if (configPath.endsWith(".json")) {
		try {
			return (JSON.parse(content) as Record<string, unknown>) || {};
		} catch {
			return {};
		}
	}
	try {
		const { parse: parseYaml } = await import("yaml");
		return (parseYaml(content) as Record<string, unknown>) || {};
	} catch {
		return {};
	}
}

/**
 * Write a config object to a file (YAML or JSON, auto-detected from the path
 * extension). Creates `CONFIG_DIR` if needed. When the config contains a
 * literal API key, writes with owner-only (0o600) permissions to prevent
 * other users from reading secrets.
 *
 * Note: `mode` only applies when the file is first created — existing files
 * keep their current permissions. `createDefaultConfig` in loader.ts always
 * uses 0o600, so the common onboarding flow (create → login) starts with the
 * right permissions.
 */
export async function writeConfigFile(configPath: string, config: Record<string, unknown>): Promise<void> {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}

	const writeOptions = containsLiteralApiKey(config) ? { mode: 0o600, encoding: "utf-8" as const } : "utf-8";

	if (configPath.endsWith(".json")) {
		await writeFile(configPath, JSON.stringify(config, null, 2), writeOptions);
		return;
	}
	const { stringify: stringifyYaml } = await import("yaml");
	await writeFile(configPath, stringifyYaml(config), writeOptions);
}
