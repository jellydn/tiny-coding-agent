/**
 * login-flow.ts — interactive login/logout flow functions.
 *
 * Each flow function prints output directly via console.log (preserving
 * the original incremental UX — headers appear before prompts, not after).
 * Returns a FlowResult with only the action ("done" | "cancelled" | "error")
 * so the handler wrapper can map it to an exit code.
 *
 * Zero process.exit() calls — the handler wrappers in login.ts handle that.
 *
 * Prompts go through the DI singleton on prompt.ts (getPromptFn() /
 * getPromptHiddenFn()). Tests override via setPromptDeps() to inject
 * mock prompts; production callers get the real readline-based functions.
 */

import { readConfigFile, writeConfigFile } from "../../config/config-io.js";
import { getConfigPath } from "../../config/loader.js";
import type { Config } from "../../config/schema.js";
import { getPromptFn, getPromptHiddenFn } from "../prompt.js";
import {
	applyProviderToConfig,
	formatProviderStatus,
	isActiveProvider,
	LOGIN_PROVIDERS,
	type LoginProviderInfo,
	removeApiKeyFromConfig,
} from "./login-shared.js";

// ===== Flow Result Type =====

export type FlowResult = { action: "done" | "cancelled" | "error" };

// ===== Login Flows =====

export async function loginProviderFlow(provider: LoginProviderInfo): Promise<FlowResult> {
	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);
	const promptFn = getPromptFn();
	const promptHiddenFn = getPromptHiddenFn();

	console.log(`\n🔐 ${provider.name} Login\n`);

	if (provider.requiresApiKey) {
		if (provider.getKeyUrl) {
			console.log(`Get your API key at: ${provider.getKeyUrl}\n`);
		}

		let apiKey: string;
		try {
			apiKey = await promptHiddenFn(`Enter your ${provider.name} API key: `);
		} catch {
			console.log("\n✗ Login cancelled.");
			return { action: "cancelled" };
		}
		if (!apiKey) {
			console.log("\n✗ No API key entered. Login cancelled.");
			return { action: "cancelled" };
		}

		// Suggest a default model
		let defaultModel: string | undefined;
		if (provider.defaultModel) {
			const existingDefault = fileConfig.defaultModel as string | undefined;
			console.log(`\nSuggested default model: ${provider.defaultModel}`);
			const confirm = await promptFn("Set as default model? [Y/n]: ");
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
		const baseUrl = await promptFn(`Base URL [${existingBaseUrl}]: `);
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

	return { action: "done" };
}

export async function loginInteractiveFlow(): Promise<FlowResult> {
	const promptFn = getPromptFn();

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

	const choice = await promptFn(`Enter choice (1-${LOGIN_PROVIDERS.length}): `);
	const index = parseInt(choice, 10) - 1;

	if (Number.isNaN(index) || index < 0 || index >= LOGIN_PROVIDERS.length) {
		console.log("\n✗ Invalid choice. Login cancelled.");
		return { action: "error" };
	}

	const provider = LOGIN_PROVIDERS[index];
	if (!provider) {
		console.log("\n✗ Invalid choice. Login cancelled.");
		return { action: "error" };
	}

	return loginProviderFlow(provider);
}

export async function showLoginStatusFlow(): Promise<FlowResult> {
	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);
	const providers = fileConfig.providers as Config["providers"] | undefined;

	console.log(`\n${formatProviderStatus(providers)}\n`);
	console.log("Run `tiny-agent login` to configure a provider.");
	console.log("Run `tiny-agent login <provider>` to configure a specific provider directly.\n");

	return { action: "done" };
}

// ===== Logout Flows =====

/**
 * Prompt the user to pick a new default model from the remaining configured
 * providers. If no other providers are configured, falls back to the Ollama
 * local default (qwen3-coder).
 */
async function promptNewDefaultModel(
	fileConfig: Record<string, unknown>,
	loggedOutProviderKey: string
): Promise<string | undefined> {
	const promptFn = getPromptFn();

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

	const choice = await promptFn(`Enter choice (1-${candidates.length}): `);
	const index = parseInt(choice, 10) - 1;

	if (Number.isNaN(index) || index < 0 || index >= candidates.length) {
		console.log("\n✗ Invalid choice. Keeping current default model.");
		return undefined;
	}

	const selected = candidates[index];
	return selected?.defaultModel;
}

export async function logoutProviderFlow(provider: LoginProviderInfo): Promise<FlowResult> {
	// Refuse for providers that don't have an API key (e.g. Ollama local)
	if (!provider.requiresApiKey) {
		console.log(`\n${provider.name} has no API key to remove.`);
		console.log(`Use 'tiny-agent login ${provider.key}' to reconfigure the base URL.\n`);
		return { action: "done" };
	}

	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);

	// Check if the provider has an apiKey to remove
	const providerConfig = (fileConfig.providers as Record<string, Record<string, unknown>>)?.[provider.key];
	const hasApiKey = !!providerConfig?.apiKey;

	if (!providerConfig) {
		console.log(`\n${provider.name} is not configured. Nothing to log out.\n`);
		return { action: "done" };
	}

	if (!hasApiKey) {
		console.log(`\n${provider.name} is configured but has no API key set. Already logged out.\n`);
		return { action: "done" };
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

	return { action: "done" };
}

export async function logoutInteractiveFlow(): Promise<FlowResult> {
	const promptFn = getPromptFn();

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
		return { action: "done" };
	}

	// Show picker
	console.log("Select a provider to log out:\n");
	providersWithKeys.forEach((p, i) => {
		const num = `${i + 1}.`.padStart(4);
		console.log(`  ${num} ${p.name}`);
	});
	console.log();

	const choice = await promptFn(`Enter choice (1-${providersWithKeys.length}): `);
	const index = parseInt(choice, 10) - 1;

	if (Number.isNaN(index) || index < 0 || index >= providersWithKeys.length) {
		console.log("\n✗ Invalid choice. Logout cancelled.");
		return { action: "error" };
	}

	const provider = providersWithKeys[index];
	if (!provider) {
		console.log("\n✗ Invalid choice. Logout cancelled.");
		return { action: "error" };
	}

	return logoutProviderFlow(provider);
}

export async function showLogoutStatusFlow(): Promise<FlowResult> {
	const configPath = getConfigPath();
	const fileConfig = await readConfigFile(configPath);
	const providers = fileConfig.providers as Config["providers"] | undefined;

	console.log(`\n${formatProviderStatus(providers)}\n`);
	console.log("Run `tiny-agent logout` to remove a provider's API key interactively.");
	console.log("Run `tiny-agent logout <provider>` to log out a specific provider directly.\n");

	return { action: "done" };
}
