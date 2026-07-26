import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { CONFIG_DIR, getConfigPath } from "../../config/loader.js";
import type { Config } from "../../config/schema.js";
import { detectProvider } from "../../providers/model-registry.js";

// ===== Types & Constants =====

export interface LoginProviderInfo {
	key: string;
	name: string;
	requiresApiKey: boolean;
	envVar?: string;
	defaultModel?: string;
	getKeyUrl?: string;
	note?: string;
}

/**
 * Providers available for login, ordered by popularity for the onboarding
 * picker. Keys match the `providers` object in config.yaml (see
 * `Config["providers"]` in schema.ts).
 */
export const LOGIN_PROVIDERS: readonly LoginProviderInfo[] = [
	{
		key: "openai",
		name: "OpenAI",
		requiresApiKey: true,
		envVar: "OPENAI_API_KEY",
		defaultModel: "gpt-4o",
		getKeyUrl: "https://platform.openai.com/api-keys",
	},
	{
		key: "anthropic",
		name: "Anthropic",
		requiresApiKey: true,
		envVar: "ANTHROPIC_API_KEY",
		defaultModel: "claude-sonnet-4-20250514",
		getKeyUrl: "https://console.anthropic.com/settings/keys",
	},
	{
		key: "ollama",
		name: "Ollama (Local)",
		requiresApiKey: false,
		defaultModel: "qwen3-coder",
		note: "Runs locally — no API key needed. Install from ollama.com",
	},
	{
		key: "ollamaCloud",
		name: "Ollama (Cloud)",
		requiresApiKey: true,
		envVar: "OLLAMA_CLOUD_API_KEY",
		defaultModel: "gpt-oss:120b-cloud",
		getKeyUrl: "https://ollama.com",
	},
	{
		key: "openrouter",
		name: "OpenRouter",
		requiresApiKey: true,
		envVar: "OPENROUTER_API_KEY",
		defaultModel: "openrouter/openai/gpt-4o",
		getKeyUrl: "https://openrouter.ai/keys",
	},
	{
		key: "opencode",
		name: "OpenCode",
		requiresApiKey: true,
		envVar: "OPENCODE_API_KEY",
		defaultModel: "opencode/big-pickle",
		getKeyUrl: "https://opencode.ai",
	},
	{
		key: "zai",
		name: "Z.AI (Zhipu)",
		requiresApiKey: true,
		envVar: "ZAI_API_KEY",
		defaultModel: "glm-4.7",
		getKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
	},
	{
		key: "clinepass",
		name: "ClinePass",
		requiresApiKey: true,
		envVar: "CLINE_API_KEY",
		defaultModel: "cline-pass/glm-5.2",
		getKeyUrl: "https://cline.bot",
	},
];

export interface ProviderStatus {
	key: string;
	name: string;
	configured: boolean;
	hasApiKey: boolean;
	requiresApiKey: boolean;
}

// ===== Pure Functions (no I/O — directly testable) =====

/** Find a login provider by key (case-insensitive). */
export function findProvider(key: string): LoginProviderInfo | undefined {
	const lower = key.toLowerCase();
	return LOGIN_PROVIDERS.find((p) => p.key.toLowerCase() === lower);
}

/** Compute connection status for every provider from a config's providers object. */
export function getProviderStatus(providers: Config["providers"] | undefined): ProviderStatus[] {
	return LOGIN_PROVIDERS.map((p) => {
		const providerConfig = providers?.[p.key as keyof NonNullable<typeof providers>];
		const configured = !!providerConfig;
		const hasApiKey = !!providerConfig?.apiKey;
		return {
			key: p.key,
			name: p.name,
			configured,
			hasApiKey,
			requiresApiKey: p.requiresApiKey,
		};
	});
}

export interface ApplyProviderOptions {
	apiKey?: string;
	baseUrl?: string;
	defaultModel?: string;
}

/**
 * Merge a provider configuration into a raw config object (as read from the
 * config file). Preserves all existing keys (other providers, mcpServers,
 * skillDirectories, etc.) and only adds/overwrites the target provider +
 * optional defaultModel. Does NOT mutate the input.
 */
export function applyProviderToConfig(
	fileConfig: Record<string, unknown>,
	providerKey: string,
	options: ApplyProviderOptions
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...fileConfig };

	// Shallow-copy the providers object so we don't mutate the input
	const existingProviders =
		result.providers && typeof result.providers === "object"
			? { ...(result.providers as Record<string, unknown>) }
			: {};
	result.providers = existingProviders;

	const providers = existingProviders as Record<string, Record<string, unknown>>;
	// Copy the existing provider entry to avoid mutation
	const existing = { ...(providers[providerKey] ?? {}) };

	const updated: Record<string, unknown> = { ...existing };
	if (options.apiKey !== undefined) {
		updated.apiKey = options.apiKey;
	}
	if (options.baseUrl !== undefined) {
		updated.baseUrl = options.baseUrl;
	}
	providers[providerKey] = updated;

	if (options.defaultModel !== undefined) {
		result.defaultModel = options.defaultModel;
	}

	return result;
}

/** Format provider connection status as a human-readable string. */
export function formatProviderStatus(providers: Config["providers"] | undefined): string {
	const statuses = getProviderStatus(providers);
	const lines: string[] = ["Provider Connection Status", "========================"];

	for (const s of statuses) {
		const icon = s.hasApiKey || (!s.requiresApiKey && s.configured) ? "●" : s.configured ? "◐" : "○";
		let statusText: string;
		if (s.requiresApiKey) {
			statusText = s.hasApiKey ? "API key set" : s.configured ? "API key required" : "not configured";
		} else {
			statusText = s.configured ? "ready" : "ready (local)";
		}
		lines.push(`  ${icon} ${s.name.padEnd(16)} ${statusText}`);
	}

	return lines.join("\n");
}

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

// ===== Config I/O Helpers (follow the mcp.ts pattern) =====

async function readConfigFile(configPath: string): Promise<Record<string, unknown>> {
	if (!existsSync(configPath)) return {};
	const content = await readFile(configPath, "utf-8");

	if (configPath.endsWith(".json")) {
		try {
			return (JSON.parse(content) as Record<string, unknown>) || {};
		} catch {
			return {};
		}
	}
	const { parse: parseYaml } = await import("yaml");
	return (parseYaml(content) as Record<string, unknown>) || {};
}

async function writeConfigFile(configPath: string, config: Record<string, unknown>): Promise<void> {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}

	// Write with owner-only permissions when the config contains a literal
	// API key, to prevent other users on the system from reading secrets.
	// Note: `mode` only applies when the file is first created — existing
	// files keep their current permissions. `createDefaultConfig` in loader.ts
	// always uses 0o600, so the common onboarding flow (create → login) starts
	// with the right permissions.
	const writeOptions = containsLiteralApiKey(config) ? { mode: 0o600, encoding: "utf-8" as const } : "utf-8";

	if (configPath.endsWith(".json")) {
		await writeFile(configPath, JSON.stringify(config, null, 2), writeOptions);
		return;
	}
	const { stringify: stringifyYaml } = await import("yaml");
	await writeFile(configPath, stringifyYaml(config), writeOptions);
}

// ===== Prompt Helpers (readline-based, matching build-agent.ts pattern) =====

async function prompt(question: string): Promise<string> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Read a line from stdin with masked input (echoes `*` for each character).
 * Falls back to plain readline when stdin is not a TTY (e.g. piped input).
 */
async function promptHidden(promptText: string): Promise<string> {
	process.stdout.write(promptText);

	const stdin = process.stdin;

	// Non-TTY fallback: use plain readline (input will be visible)
	if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
		const { createInterface } = await import("node:readline");
		const rl = createInterface({ input: stdin, output: process.stdout });
		return new Promise((resolve) => {
			rl.question("", (answer) => {
				rl.close();
				resolve(answer.trim());
			});
		});
	}

	// TTY: read character-by-character with masking
	return new Promise((resolve) => {
		let input = "";
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");

		const onData = (char: string): void => {
			const code = char.charCodeAt(0);
			switch (char) {
				case "\r":
				case "\n":
					stdin.removeListener("data", onData);
					stdin.setRawMode(false);
					stdin.pause();
					process.stdout.write("\n");
					resolve(input.trim());
					break;
				case "\u0003": // Ctrl+C
					stdin.setRawMode(false);
					stdin.pause();
					process.stdout.write("\n");
					process.exit(0);
					break;
				case "\u007f": // Delete
				case "\b": // Backspace
					if (input.length > 0) {
						input = input.slice(0, -1);
						process.stdout.write("\b \b");
					}
					break;
				default:
					// Only store printable characters (code >= 32)
					if (code >= 32) {
						input += char;
						process.stdout.write("*");
					}
			}
		};

		stdin.on("data", onData);
	});
}

// ===== Interactive Flows =====

async function loginProvider(provider: LoginProviderInfo): Promise<void> {
	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);

	console.log(`\n🔐 ${provider.name} Login\n`);

	if (provider.requiresApiKey) {
		if (provider.getKeyUrl) {
			console.log(`Get your API key at: ${provider.getKeyUrl}\n`);
		}

		const apiKey = await promptHidden(`Enter your ${provider.name} API key: `);
		if (!apiKey) {
			console.log("\n✗ No API key entered. Login cancelled.");
			process.exit(1);
		}

		// Suggest a default model
		let defaultModel: string | undefined;
		if (provider.defaultModel) {
			const existingDefault = fileConfig.defaultModel as string | undefined;
			console.log(`\nSuggested default model: ${provider.defaultModel}`);
			const confirm = await prompt("Set as default model? [Y/n]: ");
			if (confirm.toLowerCase().startsWith("y") || confirm === "") {
				defaultModel = provider.defaultModel;
			} else if (!existingDefault) {
				// No existing default model — must set one for a valid config
				console.log(`(No default model set — using ${provider.defaultModel})`);
				defaultModel = provider.defaultModel;
			}
		}

		const updatedConfig = applyProviderToConfig(fileConfig, provider.key, {
			apiKey,
			defaultModel,
		});
		await writeConfigFile(configPath, updatedConfig);

		console.log(`\n✓ Saved ${provider.name} API key to ${configPath}`);
		if (defaultModel) {
			console.log(`✓ Default model set to: ${defaultModel}`);
		}
	} else {
		// No API key needed (e.g. Ollama local)
		console.log(`${provider.note ?? "No API key needed."}\n`);

		const existingBaseUrl =
			(fileConfig.providers as Record<string, { baseUrl?: string }>)?.[provider.key]?.baseUrl ??
			"http://localhost:11434";
		const baseUrl = await prompt(`Base URL [${existingBaseUrl}]: `);
		const finalBaseUrl = baseUrl || existingBaseUrl;

		// Auto-set default model if none exists yet
		let defaultModel: string | undefined;
		if (provider.defaultModel) {
			const existingDefault = fileConfig.defaultModel as string | undefined;
			if (!existingDefault) {
				defaultModel = provider.defaultModel;
				console.log(`✓ Default model set to: ${defaultModel}`);
			}
		}

		const updatedConfig = applyProviderToConfig(fileConfig, provider.key, {
			baseUrl: finalBaseUrl,
			defaultModel,
		});
		await writeConfigFile(configPath, updatedConfig);

		console.log(`\n✓ Saved ${provider.name} configuration to ${configPath}`);
	}

	console.log(`\nLogin complete! Run \`tiny-agent chat\` to start.\n`);

	if (provider.envVar) {
		console.log(
			`Tip: For better security, store the key in an environment variable instead:\n` +
				`  1. Set apiKey: \${${provider.envVar}} in config.yaml\n` +
				`  2. Export ${provider.envVar}=your-key in your shell profile.\n`
		);
	}

	process.exit(0);
}

async function loginInteractive(): Promise<void> {
	console.log("\n🔑 Tiny Agent — Provider Login\n");
	console.log("Connect an LLM provider so you can start chatting.\n");

	// Show current status
	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);
	const providers = fileConfig.providers as Config["providers"] | undefined;
	console.log(formatProviderStatus(providers));
	console.log();

	// Show picker
	console.log("Select a provider to configure:\n");
	LOGIN_PROVIDERS.forEach((p, i) => {
		const num = `${i + 1}.`.padStart(4);
		const suffix = p.requiresApiKey ? `→ ${p.getKeyUrl ?? "API key required"}` : `→ ${p.note ?? "no API key needed"}`;
		console.log(`  ${num} ${p.name.padEnd(16)} ${suffix}`);
	});
	console.log();

	const choice = await prompt(`Enter choice (1-${LOGIN_PROVIDERS.length}): `);
	const index = parseInt(choice, 10) - 1;

	if (Number.isNaN(index) || index < 0 || index >= LOGIN_PROVIDERS.length) {
		console.log("\n✗ Invalid choice. Login cancelled.");
		process.exit(1);
	}

	const provider = LOGIN_PROVIDERS[index];
	if (!provider) {
		console.log("\n✗ Invalid choice. Login cancelled.");
		process.exit(1);
	}

	await loginProvider(provider);
}

async function showLoginStatus(): Promise<void> {
	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);
	const providers = fileConfig.providers as Config["providers"] | undefined;

	console.log(`\n${formatProviderStatus(providers)}\n`);
	console.log("Run `tiny-agent login` to configure a provider.");
	console.log("Run `tiny-agent login <provider>` to configure a specific provider directly.\n");
	process.exit(0);
}

// ===== Logout: Pure Helper =====

/**
 * Remove the `apiKey` from a provider's config entry, preserving `baseUrl`
 * and any other fields. Does NOT delete the provider entry itself — the
 * provider stays "configured" (e.g. with a custom baseUrl) but is
 * "disconnected" (no key). Does NOT mutate the input.
 *
 * If the provider has no apiKey or no entry at all, the config is returned
 * unchanged (idempotent for the "already logged out" state).
 */
export function removeApiKeyFromConfig(
	fileConfig: Record<string, unknown>,
	providerKey: string
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...fileConfig };

	const existingProviders =
		result.providers && typeof result.providers === "object"
			? { ...(result.providers as Record<string, unknown>) }
			: {};
	result.providers = existingProviders;

	const providers = existingProviders as Record<string, Record<string, unknown>>;
	const existing = providers[providerKey];
	if (!existing || typeof existing !== "object") {
		return result;
	}

	// Shallow-copy and delete the apiKey key
	const updated: Record<string, unknown> = { ...existing };
	delete updated.apiKey;
	providers[providerKey] = updated;

	return result;
}

// ===== Logout: Interactive Flows =====

/**
 * Check if the given provider key matches the provider that the current
 * `defaultModel` auto-detects to. Returns false if no defaultModel is set
 * or if detectProvider throws.
 */
function isActiveProvider(providerKey: string, defaultModel: unknown): boolean {
	if (typeof defaultModel !== "string" || !defaultModel) return false;
	try {
		return detectProvider(defaultModel) === providerKey;
	} catch {
		return false;
	}
}

/**
 * Prompt the user to pick a new default model from the remaining configured
 * providers. If no other providers are configured, falls back to the Ollama
 * local default (qwen3-coder).
 */
async function promptNewDefaultModel(
	fileConfig: Record<string, unknown>,
	loggedOutProviderKey: string
): Promise<string | undefined> {
	// Find providers that still have an apiKey (or don't require one)
	const providers = (fileConfig.providers ?? {}) as Record<string, Record<string, unknown>>;
	const candidates = LOGIN_PROVIDERS.filter((p) => {
		if (p.key === loggedOutProviderKey) return false;
		const cfg = providers[p.key];
		if (!cfg) return false;
		if (p.requiresApiKey) return !!cfg.apiKey;
		return true; // no-key providers like Ollama local are always "ready"
	});

	if (candidates.length === 0) {
		// No other providers configured — fall back to Ollama local default
		const fallback = "qwen3-coder";
		console.log(`\nNo other providers configured. Falling back to: ${fallback}`);
		return fallback;
	}

	if (candidates.length === 1) {
		const only = candidates[0];
		if (only?.defaultModel) {
			console.log(`\nSwitching default model to ${only.name}: ${only.defaultModel}`);
			return only.defaultModel;
		}
	}

	// Multiple candidates — show a picker
	console.log("\nSelect a new default model:\n");
	candidates.forEach((p, i) => {
		const num = `${i + 1}.`.padStart(4);
		const model = p.defaultModel ?? "(unknown)";
		console.log(`  ${num} ${p.name.padEnd(16)} ${model}`);
	});
	console.log();

	const choice = await prompt(`Enter choice (1-${candidates.length}): `);
	const index = parseInt(choice, 10) - 1;

	if (Number.isNaN(index) || index < 0 || index >= candidates.length) {
		console.log("\n✗ Invalid choice. Keeping current default model.");
		return undefined;
	}

	const selected = candidates[index];
	return selected?.defaultModel;
}

async function logoutProvider(provider: LoginProviderInfo): Promise<void> {
	// Refuse for providers that don't have an API key (e.g. Ollama local)
	if (!provider.requiresApiKey) {
		console.log(`\n${provider.name} has no API key to remove.`);
		console.log(`Use 'tiny-agent login ${provider.key}' to reconfigure the base URL.\n`);
		process.exit(0);
	}

	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);

	// Check if the provider has an apiKey to remove
	const providerConfig = (fileConfig.providers as Record<string, Record<string, unknown>>)?.[provider.key];
	const hasApiKey = !!providerConfig?.apiKey;

	if (!providerConfig) {
		console.log(`\n${provider.name} is not configured. Nothing to log out.\n`);
		process.exit(0);
	}

	if (!hasApiKey) {
		console.log(`\n${provider.name} is configured but has no API key set. Already logged out.\n`);
		process.exit(0);
	}

	// Remove the apiKey
	let updatedConfig = removeApiKeyFromConfig(fileConfig, provider.key);

	// Check if the logged-out provider was the active default model
	const currentDefault = fileConfig.defaultModel;
	if (isActiveProvider(provider.key, currentDefault)) {
		console.log(`\n⚠️  The default model (${currentDefault}) uses ${provider.name}.`);
		const newModel = await promptNewDefaultModel(updatedConfig, provider.key);
		if (newModel) {
			updatedConfig = { ...updatedConfig, defaultModel: newModel };
			console.log(`✓ Default model set to: ${newModel}`);
		}
	}

	await writeConfigFile(configPath, updatedConfig);

	console.log(`\n✓ Removed ${provider.name} API key from ${configPath}`);
	console.log(
		`\nLogout complete! The ${provider.name} provider entry is preserved (baseUrl, etc.) but has no API key.\n`
	);
	process.exit(0);
}

async function logoutInteractive(): Promise<void> {
	console.log("\n🔒 Tiny Agent — Provider Logout\n");

	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);
	const providers = fileConfig.providers as Config["providers"] | undefined;

	// Show current status
	console.log(formatProviderStatus(providers));
	console.log();

	// Filter to providers that have an API key set (can be logged out)
	const providersWithKeys = LOGIN_PROVIDERS.filter((p) => {
		if (!p.requiresApiKey) return false;
		const cfg = providers?.[p.key as keyof NonNullable<typeof providers>];
		return !!cfg?.apiKey;
	});

	if (providersWithKeys.length === 0) {
		console.log("No providers have an API key set. Nothing to log out.\n");
		process.exit(0);
	}

	// Show picker
	console.log("Select a provider to log out:\n");
	providersWithKeys.forEach((p, i) => {
		const num = `${i + 1}.`.padStart(4);
		console.log(`  ${num} ${p.name}`);
	});
	console.log();

	const choice = await prompt(`Enter choice (1-${providersWithKeys.length}): `);
	const index = parseInt(choice, 10) - 1;

	if (Number.isNaN(index) || index < 0 || index >= providersWithKeys.length) {
		console.log("\n✗ Invalid choice. Logout cancelled.");
		process.exit(1);
	}

	const provider = providersWithKeys[index];
	if (!provider) {
		console.log("\n✗ Invalid choice. Logout cancelled.");
		process.exit(1);
	}

	await logoutProvider(provider);
}

// ===== Main Handlers =====

export async function handleLogin(args: string[]): Promise<void> {
	const subCommand = args[0];

	if (subCommand === "status") {
		await showLoginStatus();
		return;
	}

	// If a provider key was given as arg, go straight to it
	if (subCommand) {
		const provider = findProvider(subCommand);
		if (provider) {
			await loginProvider(provider);
			return;
		}
		console.error(`Unknown provider: ${subCommand}`);
		console.error(`Available: ${LOGIN_PROVIDERS.map((p) => p.key).join(", ")}`);
		process.exit(1);
	}

	// Interactive picker
	await loginInteractive();
}

// ===== Logout: Status & Main Handler =====

async function showLogoutStatus(): Promise<void> {
	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);
	const providers = fileConfig.providers as Config["providers"] | undefined;

	console.log(`\n${formatProviderStatus(providers)}\n`);
	console.log("Run `tiny-agent logout` to remove a provider's API key interactively.");
	console.log("Run `tiny-agent logout <provider>` to log out a specific provider directly.\n");
	process.exit(0);
}

export async function handleLogout(args: string[]): Promise<void> {
	const subCommand = args[0];

	if (subCommand === "status") {
		await showLogoutStatus();
		return;
	}

	// If a provider key was given as arg, go straight to it
	if (subCommand) {
		const provider = findProvider(subCommand);
		if (provider) {
			await logoutProvider(provider);
			return;
		}
		console.error(`Unknown provider: ${subCommand}`);
		console.error(`Available: ${LOGIN_PROVIDERS.map((p) => p.key).join(", ")}`);
		process.exit(1);
	}

	// Interactive picker
	await logoutInteractive();
}
