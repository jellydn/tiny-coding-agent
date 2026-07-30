/**
 * login.ts — thin handler wrappers for the login/logout CLI commands.
 *
 * All flow logic lives in login-flow.ts (returns FlowResult with action
 * only, zero process.exit() calls). All pure functions, types, and
 * constants live in login-shared.ts. This file maps FlowResult.action
 * to exit codes and re-exports the pure layer for backward compatibility.
 *
 * Architecture (ADR-016 decomposition):
 *   login.ts → login-flow.ts → login-shared.ts
 *   (handlers)   (flows)       (pure functions)
 *   No circular dependencies — each layer depends only on the one below.
 */

import {
	type FlowResult,
	loginInteractiveFlow,
	loginProviderFlow,
	logoutInteractiveFlow,
	logoutProviderFlow,
	showLoginStatusFlow,
	showLogoutStatusFlow,
} from "./login-flow.js";
import { findProvider, LOGIN_PROVIDERS } from "./login-shared.js";

// Re-export containsLiteralApiKey from config-io.ts (unchanged).
export { containsLiteralApiKey } from "../../config/config-io.js";
// Re-export FlowResult type for tests that may want to assert on it.
export type { FlowResult } from "./login-flow.js";
// Re-export for backward compatibility — tests and other modules import
// pure functions, types, and constants from login.ts. The canonical home
// is now login-shared.ts.
export {
	type ApplyProviderOptions,
	applyProviderToConfig,
	findProvider,
	formatProviderStatus,
	getProviderStatus,
	isActiveProvider,
	LOGIN_PROVIDERS,
	type LoginProviderInfo,
	type ProviderStatus,
	removeApiKeyFromConfig,
} from "./login-shared.js";

// ===== Handler wrappers (exit-mappers only) =====

function handleFlowResult(result: FlowResult): void {
	if (result.action === "error" || result.action === "cancelled") {
		process.exit(1);
	}
	process.exit(0);
}

export async function handleLogin(args: string[]): Promise<void> {
	const subCommand = args[0];

	if (subCommand === "status") {
		const result = await showLoginStatusFlow();
		handleFlowResult(result);
		return;
	}

	// If a provider key was given as arg, go straight to it
	if (subCommand) {
		const provider = findProvider(subCommand);
		if (provider) {
			const result = await loginProviderFlow(provider);
			handleFlowResult(result);
			return;
		}
		console.error(`Unknown provider: ${subCommand}`);
		console.error(`Available: ${LOGIN_PROVIDERS.map((p) => p.key).join(", ")}`);
		process.exit(1);
	}

	// Interactive picker
	const result = await loginInteractiveFlow();
	handleFlowResult(result);
}

export async function handleLogout(args: string[]): Promise<void> {
	const subCommand = args[0];

	if (subCommand === "status") {
		const result = await showLogoutStatusFlow();
		handleFlowResult(result);
		return;
	}

	// If a provider key was given as arg, go straight to it
	if (subCommand) {
		const provider = findProvider(subCommand);
		if (provider) {
			const result = await logoutProviderFlow(provider);
			handleFlowResult(result);
			return;
		}
		console.error(`Unknown provider: ${subCommand}`);
		console.error(`Available: ${LOGIN_PROVIDERS.map((p) => p.key).join(", ")}`);
		process.exit(1);
	}

	// Interactive picker
	const result = await logoutInteractiveFlow();
	handleFlowResult(result);
}
