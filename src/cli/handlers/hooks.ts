/**
 * Hooks CLI handler — manage lifecycle hooks from the command line.
 *
 * Subcommands:
 *   hooks list              — show all configured hooks
 *   hooks presets           — list available built-in presets
 *   hooks install <preset>  — install a preset (e.g. plannotator) into config
 *   hooks enable <name>     — enable a hook by name
 *   hooks disable <name>    — disable a hook by name
 *   hooks remove <name>     — remove a hook from config
 */

import { readConfigFile, writeConfigFile } from "../../config/config-io.js";
import { getConfigPath } from "../../config/loader.js";
import { BUILTIN_PRESETS, findPreset, listPresetIds } from "../../hooks/index.js";
import type { HookConfig } from "../../hooks/types.js";
import { isCommandAvailable } from "../../utils/command.js";
import type { CliOptions } from "../shared.js";

/** Display all configured hooks. */
async function showHooksList(configPath: string): Promise<void> {
	const fileConfig = await readConfigFile(configPath);
	const hooks = (fileConfig.hooks as HookConfig[] | undefined) ?? [];

	if (hooks.length === 0) {
		console.log("\nNo hooks configured.");
		console.log("Run 'tiny-agent hooks presets' to see available presets.");
		console.log("Run 'tiny-agent hooks install plannotator' to install plannotator.\n");
		process.exit(0);
	}

	console.log("\n📋 Configured Hooks");
	console.log("=".repeat(50));

	for (const hook of hooks) {
		const status = hook.enabled === false ? "○ disabled" : "● enabled";
		console.log(`\n  ${status}  ${hook.name}`);
		console.log(`    Event:   ${hook.event}`);
		console.log(`    Command: ${hook.command}${hook.args ? ` ${hook.args.join(" ")}` : ""}`);
		if (hook.timeoutMs && hook.timeoutMs > 0) {
			console.log(`    Timeout: ${hook.timeoutMs}ms`);
		}
		if (hook.inputMode && hook.inputMode !== "stdin") {
			console.log(`    Input:   ${hook.inputMode}`);
		}
	}

	console.log(`\n${hooks.length} hook(s) configured.\n`);
	process.exit(0);
}

/** Display available hook presets. */
async function showPresets(): Promise<void> {
	console.log("\n📦 Available Hook Presets");
	console.log("=".repeat(50));

	for (const preset of BUILTIN_PRESETS) {
		console.log(`\n  ${preset.id}`);
		console.log(`  ${preset.name}`);
		console.log(`  ${preset.description}`);

		// Check if the command binary is available
		if (preset.checkCommand) {
			const available = await isCommandAvailable(preset.checkCommand);
			const status = available ? "✓ installed" : "✗ not found";
			console.log(`  Binary:  ${preset.checkCommand} (${status})`);
		}

		console.log(`  Hooks:   ${preset.hooks.length} hook(s)`);
		for (const h of preset.hooks) {
			const enabled = h.enabled === false ? "(disabled)" : "(enabled)";
			console.log(`    - ${h.name} [${h.event}] ${enabled}`);
		}
	}

	console.log(`\nInstall a preset: tiny-agent hooks install <id>`);
	console.log(`Available presets: ${listPresetIds().join(", ")}\n`);
	process.exit(0);
}

/** Install a preset into the config file. */
async function installPreset(configPath: string, presetId: string): Promise<void> {
	const preset = findPreset(presetId);
	if (!preset) {
		console.error(`\n✗ Unknown preset: ${presetId}`);
		console.error(`Available presets: ${listPresetIds().join(", ")}\n`);
		process.exit(1);
	}

	// Check if the binary is available
	if (preset.checkCommand) {
		const available = await isCommandAvailable(preset.checkCommand);
		if (!available) {
			console.warn(`\n⚠️  Command "${preset.checkCommand}" not found.`);
			if (preset.installInstructions) {
				console.warn(preset.installInstructions);
			}
			console.warn("\nInstalling anyway — the hook will be skipped until the binary is available.\n");
		}
	}

	const fileConfig = await readConfigFile(configPath);
	const existingHooks = (fileConfig.hooks as HookConfig[] | undefined) ?? [];

	// Check if any hook from this preset is already installed
	const presetNames = new Set(preset.hooks.map((h) => h.name));
	const conflicts = existingHooks.filter((h) => presetNames.has(h.name));

	if (conflicts.length > 0) {
		console.log(`\n⚠️  Some hooks from preset "${presetId}" are already installed:`);
		for (const c of conflicts) {
			console.log(`  - ${c.name}`);
		}
		console.log("\nRemoving existing entries and reinstalling...\n");
	}

	// Remove conflicting hooks, then add the preset's hooks
	const filtered = existingHooks.filter((h) => !presetNames.has(h.name));
	const updatedHooks = [...filtered, ...preset.hooks];

	const updatedConfig = { ...fileConfig, hooks: updatedHooks };
	await writeConfigFile(configPath, updatedConfig);

	console.log(`\n✓ Installed preset "${presetId}" (${preset.hooks.length} hooks)`);
	console.log(`✓ Config saved to ${configPath}`);

	for (const h of preset.hooks) {
		const status = h.enabled === false ? "(disabled)" : "(enabled)";
		console.log(`  - ${h.name} [${h.event}] ${status}`);
	}

	console.log("\nRun 'tiny-agent hooks list' to see all configured hooks.\n");
	process.exit(0);
}

/** Enable a hook by name. */
async function enableHook(configPath: string, name: string): Promise<void> {
	const fileConfig = await readConfigFile(configPath);
	const hooks = (fileConfig.hooks as HookConfig[] | undefined) ?? [];

	const hook = hooks.find((h) => h.name === name);
	if (!hook) {
		console.error(`\n✗ Hook not found: ${name}`);
		console.error(`Configured hooks: ${hooks.map((h) => h.name).join(", ") || "(none)"}\n`);
		process.exit(1);
	}

	hook.enabled = true;
	await writeConfigFile(configPath, fileConfig);
	console.log(`\n✓ Enabled hook: ${name}\n`);
	process.exit(0);
}

/** Disable a hook by name. */
async function disableHook(configPath: string, name: string): Promise<void> {
	const fileConfig = await readConfigFile(configPath);
	const hooks = (fileConfig.hooks as HookConfig[] | undefined) ?? [];

	const hook = hooks.find((h) => h.name === name);
	if (!hook) {
		console.error(`\n✗ Hook not found: ${name}`);
		console.error(`Configured hooks: ${hooks.map((h) => h.name).join(", ") || "(none)"}\n`);
		process.exit(1);
	}

	hook.enabled = false;
	await writeConfigFile(configPath, fileConfig);
	console.log(`\n✓ Disabled hook: ${name}\n`);
	process.exit(0);
}

/** Remove a hook by name. */
async function removeHook(configPath: string, name: string): Promise<void> {
	const fileConfig = await readConfigFile(configPath);
	const hooks = (fileConfig.hooks as HookConfig[] | undefined) ?? [];

	const filtered = hooks.filter((h) => h.name !== name);
	if (filtered.length === hooks.length) {
		console.error(`\n✗ Hook not found: ${name}\n`);
		process.exit(1);
	}

	const updatedConfig = { ...fileConfig, hooks: filtered.length > 0 ? filtered : undefined };
	await writeConfigFile(configPath, updatedConfig);
	console.log(`\n✓ Removed hook: ${name}\n`);
	process.exit(0);
}

export async function handleHooks(_config: unknown, args: string[], _options: CliOptions): Promise<void> {
	const configPath = getConfigPath();
	const subcommand = args[0];

	if (!subcommand) {
		console.error("Error: hooks command requires a subcommand");
		console.error("");
		console.error("  hooks list              — show all configured hooks");
		console.error("  hooks presets           — list available presets");
		console.error("  hooks install <preset>  — install a preset (e.g. plannotator)");
		console.error("  hooks enable <name>     — enable a hook");
		console.error("  hooks disable <name>    — disable a hook");
		console.error("  hooks remove <name>     — remove a hook");
		process.exit(2);
	}

	switch (subcommand) {
		case "list":
			await showHooksList(configPath);
			return;
		case "presets":
			await showPresets();
			return;
		case "install": {
			const presetId = args[1];
			if (!presetId) {
				console.error("Error: install requires a preset ID");
				console.error(`Available presets: ${listPresetIds().join(", ")}`);
				process.exit(2);
			}
			await installPreset(configPath, presetId);
			return;
		}
		case "enable": {
			const name = args[1];
			if (!name) {
				console.error("Error: enable requires a hook name");
				process.exit(2);
			}
			await enableHook(configPath, name);
			return;
		}
		case "disable": {
			const name = args[1];
			if (!name) {
				console.error("Error: disable requires a hook name");
				process.exit(2);
			}
			await disableHook(configPath, name);
			return;
		}
		case "remove": {
			const name = args[1];
			if (!name) {
				console.error("Error: remove requires a hook name");
				process.exit(2);
			}
			await removeHook(configPath, name);
			return;
		}
		default:
			console.error(`Unknown hooks subcommand: ${subcommand}`);
			console.error("Available: list, presets, install, enable, disable, remove");
			process.exit(2);
	}
}
