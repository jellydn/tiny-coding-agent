import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import * as readline from "node:readline";
import {
	applyProviderToConfig,
	containsLiteralApiKey,
	findProvider,
	formatProviderStatus,
	getProviderStatus,
	handleLogin,
	LOGIN_PROVIDERS,
} from "../../../src/cli/handlers/login.js";
import type { Config } from "../../../src/config/schema.js";

describe("login handler", () => {
	describe("LOGIN_PROVIDERS", () => {
		it("should include all 8 providers from the factory", () => {
			const keys = LOGIN_PROVIDERS.map((p) => p.key);
			expect(keys).toContain("openai");
			expect(keys).toContain("anthropic");
			expect(keys).toContain("ollama");
			expect(keys).toContain("ollamaCloud");
			expect(keys).toContain("openrouter");
			expect(keys).toContain("opencode");
			expect(keys).toContain("zai");
			expect(keys).toContain("clinepass");
			expect(keys).toHaveLength(8);
		});

		it("should have a default model for every provider", () => {
			for (const p of LOGIN_PROVIDERS) {
				expect(p.defaultModel, `${p.key} should have a defaultModel`).toBeDefined();
			}
		});

		it("should mark ollama as not requiring an API key", () => {
			const ollama = LOGIN_PROVIDERS.find((p) => p.key === "ollama");
			expect(ollama?.requiresApiKey).toBe(false);
		});

		it("should mark all cloud providers as requiring an API key", () => {
			for (const p of LOGIN_PROVIDERS) {
				if (p.key === "ollama") continue;
				expect(p.requiresApiKey, `${p.key} should require an API key`).toBe(true);
			}
		});

		it("should include an envVar for every provider that requires an API key", () => {
			for (const p of LOGIN_PROVIDERS) {
				if (p.requiresApiKey) {
					expect(p.envVar, `${p.key} should have an envVar`).toBeDefined();
				}
			}
		});
	});

	describe("findProvider()", () => {
		it("should find a provider by exact key", () => {
			expect(findProvider("openai")?.key).toBe("openai");
			expect(findProvider("anthropic")?.key).toBe("anthropic");
		});

		it("should be case-insensitive", () => {
			expect(findProvider("OpenAI")?.key).toBe("openai");
			expect(findProvider("ANTHROPIC")?.key).toBe("anthropic");
			expect(findProvider("OllamaCloud")?.key).toBe("ollamaCloud");
		});

		it("should return undefined for an unknown provider", () => {
			expect(findProvider("nonexistent")).toBeUndefined();
		});

		it("should return undefined for empty string", () => {
			expect(findProvider("")).toBeUndefined();
		});
	});

	describe("getProviderStatus()", () => {
		it("should return not-configured for an empty providers object", () => {
			const statuses = getProviderStatus(undefined);
			expect(statuses).toHaveLength(8);
			for (const s of statuses) {
				expect(s.configured).toBe(false);
				expect(s.hasApiKey).toBe(false);
			}
		});

		it("should mark a provider with an API key as configured + hasApiKey", () => {
			const providers: Config["providers"] = {
				openai: { apiKey: "sk-test" },
			};
			const openai = getProviderStatus(providers).find((s) => s.key === "openai");
			expect(openai?.configured).toBe(true);
			expect(openai?.hasApiKey).toBe(true);
		});

		it("should mark a provider configured without an API key as configured but no key", () => {
			const providers: Config["providers"] = {
				ollama: { baseUrl: "http://localhost:11434" },
			};
			const ollama = getProviderStatus(providers).find((s) => s.key === "ollama");
			expect(ollama?.configured).toBe(true);
			expect(ollama?.hasApiKey).toBe(false);
		});

		it("should reflect multiple configured providers", () => {
			const providers: Config["providers"] = {
				openai: { apiKey: "sk-test" },
				anthropic: { apiKey: "sk-ant" },
				ollama: { baseUrl: "http://localhost:11434" },
			};
			const statuses = getProviderStatus(providers);
			const configured = statuses.filter((s) => s.configured);
			expect(configured).toHaveLength(3);
		});
	});

	describe("applyProviderToConfig()", () => {
		it("should add a new provider to an empty config", () => {
			const result = applyProviderToConfig({}, "openai", { apiKey: "sk-test" });
			expect(result.providers).toEqual({ openai: { apiKey: "sk-test" } });
		});

		it("should add a provider without overwriting existing providers", () => {
			const input: Record<string, unknown> = {
				providers: { anthropic: { apiKey: "sk-ant" } },
			};
			const result = applyProviderToConfig(input, "openai", { apiKey: "sk-test" });
			expect(result.providers).toEqual({
				anthropic: { apiKey: "sk-ant" },
				openai: { apiKey: "sk-test" },
			});
		});

		it("should preserve other top-level keys (mcpServers, skillDirectories)", () => {
			const input: Record<string, unknown> = {
				defaultModel: "llama3.2",
				mcpServers: { context7: { command: "npx" } },
				skillDirectories: ["~/.tiny-agent/skills/"],
				providers: { anthropic: { apiKey: "sk-ant" } },
			};
			const result = applyProviderToConfig(input, "openai", { apiKey: "sk-test" });
			expect(result.defaultModel).toBe("llama3.2");
			expect(result.mcpServers).toEqual({ context7: { command: "npx" } });
			expect(result.skillDirectories).toEqual(["~/.tiny-agent/skills/"]);
		});

		it("should overwrite an existing provider's API key", () => {
			const input: Record<string, unknown> = {
				providers: { openai: { apiKey: "old-key", baseUrl: "https://custom.api" } },
			};
			const result = applyProviderToConfig(input, "openai", { apiKey: "new-key" });
			expect(result.providers).toEqual({
				openai: { apiKey: "new-key", baseUrl: "https://custom.api" },
			});
		});

		it("should preserve an existing baseUrl when only updating the API key", () => {
			const input: Record<string, unknown> = {
				providers: { openai: { baseUrl: "https://custom.api" } },
			};
			const result = applyProviderToConfig(input, "openai", { apiKey: "sk-test" });
			expect(result.providers).toEqual({
				openai: { baseUrl: "https://custom.api", apiKey: "sk-test" },
			});
		});

		it("should set the defaultModel when provided", () => {
			const result = applyProviderToConfig({}, "openai", {
				apiKey: "sk-test",
				defaultModel: "gpt-4o",
			});
			expect(result.defaultModel).toBe("gpt-4o");
		});

		it("should NOT set defaultModel when not provided", () => {
			const input: Record<string, unknown> = { defaultModel: "llama3.2" };
			const result = applyProviderToConfig(input, "openai", { apiKey: "sk-test" });
			expect(result.defaultModel).toBe("llama3.2");
		});

		it("should set both apiKey and baseUrl", () => {
			const result = applyProviderToConfig({}, "ollama", {
				baseUrl: "http://localhost:11434",
				defaultModel: "qwen3-coder",
			});
			expect(result.providers).toEqual({ ollama: { baseUrl: "http://localhost:11434" } });
			expect(result.defaultModel).toBe("qwen3-coder");
		});

		it("should not mutate the input object", () => {
			const input: Record<string, unknown> = {
				providers: { openai: { apiKey: "old" } },
			};
			applyProviderToConfig(input, "openai", { apiKey: "new" });
			// Original should be unchanged
			const originalProviders = input.providers as Record<string, { apiKey: string }>;
			expect(originalProviders.openai?.apiKey).toBe("old");
		});
	});
	describe("formatProviderStatus()", () => {
		it("should include a header and every provider name", () => {
			const output = formatProviderStatus(undefined);
			expect(output).toContain("Provider Connection Status");
			expect(output).toContain("OpenAI");
			expect(output).toContain("Anthropic");
			expect(output).toContain("Ollama (Local)");
			expect(output).toContain("OpenRouter");
		});

		it("should show 'not configured' for unconfigured providers", () => {
			const output = formatProviderStatus(undefined);
			expect(output).toContain("not configured");
		});

		it("should show 'API key set' for a configured provider with a key", () => {
			const providers: Config["providers"] = { openai: { apiKey: "sk-test" } };
			const output = formatProviderStatus(providers);
			expect(output).toContain("API key set");
		});

		it("should show 'ready' for a configured local provider", () => {
			const providers: Config["providers"] = { ollama: { baseUrl: "http://localhost:11434" } };
			const output = formatProviderStatus(providers);
			// Ollama local doesn't require API key — "ready" when configured
			expect(output).toContain("ready");
		});
	});

	describe("containsLiteralApiKey()", () => {
		// Construct env-var reference strings via concatenation to avoid
		// Biome's noTemplateCurlyInString lint rule, which flags ${...} in
		// non-template-literal strings. These represent the literal text
		// "${OPENAI_API_KEY}" as it would appear in config.yaml.
		const OPENAI_REF = "${" + "OPENAI_API_KEY}";
		const ANTHROPIC_REF = "${" + "ANTHROPIC_API_KEY}";

		it("should return false for an empty config", () => {
			expect(containsLiteralApiKey({})).toBe(false);
		});

		it("should return false when no providers object exists", () => {
			expect(containsLiteralApiKey({ defaultModel: "gpt-4o" })).toBe(false);
		});

		it("should return false for providers with no apiKey", () => {
			expect(containsLiteralApiKey({ providers: { ollama: { baseUrl: "http://localhost:11434" } } })).toBe(false);
		});

		it("should return true for a literal API key", () => {
			expect(containsLiteralApiKey({ providers: { openai: { apiKey: "sk-test-key" } } })).toBe(true);
		});

		it("should return false for an env-var reference apiKey", () => {
			expect(containsLiteralApiKey({ providers: { openai: { apiKey: OPENAI_REF } } })).toBe(false);
		});

		it("should return false for an empty apiKey string", () => {
			expect(containsLiteralApiKey({ providers: { openai: { apiKey: "" } } })).toBe(false);
		});

		it("should return true if any provider has a literal key", () => {
			expect(
				containsLiteralApiKey({
					providers: {
						ollama: { baseUrl: "http://localhost:11434" },
						openai: { apiKey: OPENAI_REF },
						anthropic: { apiKey: "sk-ant-test" },
					},
				})
			).toBe(true);
		});

		it("should return false when all apiKeys are env-var references", () => {
			expect(
				containsLiteralApiKey({
					providers: {
						openai: { apiKey: OPENAI_REF },
						anthropic: { apiKey: ANTHROPIC_REF },
					},
				})
			).toBe(false);
		});

		it("should handle non-object providers gracefully", () => {
			expect(containsLiteralApiKey({ providers: "not-an-object" })).toBe(false);
			expect(containsLiteralApiKey({ providers: null })).toBe(false);
			expect(containsLiteralApiKey({ providers: [] })).toBe(false);
		});
	});
});

// ===== handleLogin() smoke tests =====
// Follows the state.test.ts pattern: spy on console.log/console.error +
// process.exit, write a temp config file, and assert output + exit codes.
// Both config env vars are overridden (see beforeEach) so getConfigPath()
// never touches the user's real ~/.tiny-agent/config.{yaml,json}.

describe("handleLogin", () => {
	// Use a unique temp path per module load. We override BOTH config env vars
	// so getConfigPath() can never fall through to the user's real
	// ~/.tiny-agent/config.{yaml,json} (which would make the "missing config"
	// test flaky depending on the host machine).
	const TEMP_CONFIG_FILE = `/tmp/test-login-config-${Date.now()}.yaml`;
	const TEMP_CONFIG_JSON = `/tmp/test-login-config-${Date.now()}.json`;
	let originalConfigYaml: string | undefined;
	let originalConfigJson: string | undefined;

	beforeEach(() => {
		originalConfigYaml = process.env.TINY_AGENT_CONFIG_YAML;
		originalConfigJson = process.env.TINY_AGENT_CONFIG_JSON;
		process.env.TINY_AGENT_CONFIG_YAML = TEMP_CONFIG_FILE;
		process.env.TINY_AGENT_CONFIG_JSON = TEMP_CONFIG_JSON;
		for (const f of [TEMP_CONFIG_FILE, TEMP_CONFIG_JSON]) {
			if (existsSync(f)) unlinkSync(f);
		}
	});

	afterEach(() => {
		for (const f of [TEMP_CONFIG_FILE, TEMP_CONFIG_JSON]) {
			if (existsSync(f)) unlinkSync(f);
		}
		if (originalConfigYaml === undefined) {
			delete process.env.TINY_AGENT_CONFIG_YAML;
		} else {
			process.env.TINY_AGENT_CONFIG_YAML = originalConfigYaml;
		}
		if (originalConfigJson === undefined) {
			delete process.env.TINY_AGENT_CONFIG_JSON;
		} else {
			process.env.TINY_AGENT_CONFIG_JSON = originalConfigJson;
		}
	});

	it("should show provider status with 'status' subcommand (configured providers)", async () => {
		// Write a temp config with a couple of providers configured
		const yamlContent = `defaultModel: gpt-4o
providers:
  openai:
    apiKey: sk-test-key
  ollama:
    baseUrl: http://localhost:11434
`;
		await writeFile(TEMP_CONFIG_FILE, yamlContent, "utf-8");

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleLogin(["status"])).rejects.toThrow("exit");

		// Should have printed the status header and provider names
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Provider Connection Status"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("OpenAI"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("API key set"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Run `tiny-agent login`"));
		// Should exit with code 0 (success)
		expect(processExitSpy).toHaveBeenCalledWith(0);

		consoleLogSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should show 'not configured' when no providers are configured", async () => {
		// Write a minimal config with no providers
		const yamlContent = `defaultModel: llama3.2
providers: {}
`;
		await writeFile(TEMP_CONFIG_FILE, yamlContent, "utf-8");

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleLogin(["status"])).rejects.toThrow("exit");

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("not configured"));
		expect(processExitSpy).toHaveBeenCalledWith(0);

		consoleLogSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should show status even when config file does not exist", async () => {
		// No config file written — getConfigPath() returns the (non-existent)
		// path, readConfigFile returns {}, and all providers show as not configured.
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleLogin(["status"])).rejects.toThrow("exit");

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Provider Connection Status"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("not configured"));
		expect(processExitSpy).toHaveBeenCalledWith(0);

		consoleLogSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	it("should exit with error for an unknown provider argument", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});

		await expect(handleLogin(["nonexistent"])).rejects.toThrow("exit");

		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown provider: nonexistent"));
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(LOGIN_PROVIDERS.map((p) => p.key).join(", ")));
		expect(processExitSpy).toHaveBeenCalledWith(1);

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	});

	// ===== Interactive picker smoke tests =====
	// These mock readline.createInterface so that prompt() and promptHidden()
	// (non-TTY fallback) return predetermined answers from a queue.
	// stdin.isTTY is forced to false so promptHidden takes the readline path.

	it("should complete interactive picker login for OpenAI (provider 1)", async () => {
		const answers = ["1", "sk-test-key-123", "y"];
		let answerIndex = 0;

		// Force non-TTY so promptHidden uses the readline fallback
		const originalIsTTY = process.stdin.isTTY;
		process.stdin.isTTY = false;

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
			() =>
				({
					question: (_q: string, cb: (answer: string) => void) => {
						queueMicrotask(() => cb(answers[answerIndex++] ?? ""));
					},
					close: () => {},
				}) as unknown as readline.Interface
		);

		await expect(handleLogin([])).rejects.toThrow("exit");

		// Should have shown the picker header and provider list
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Provider Login"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Select a provider"));
		// Should have shown the OpenAI login header
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("OpenAI Login"));
		// Should have saved the key and set the default model
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Saved OpenAI API key"));
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Default model set to: gpt-4o"));
		// Should have printed the env-var security tip (OpenAI has envVar: OPENAI_API_KEY)
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("OPENAI_API_KEY"));
		expect(processExitSpy).toHaveBeenCalledWith(0);

		// Verify the config file was actually written with the API key
		const written = await readFile(TEMP_CONFIG_FILE, "utf-8");
		expect(written).toContain("sk-test-key-123");
		expect(written).toContain("gpt-4o");

		process.stdin.isTTY = originalIsTTY;
		consoleLogSpy.mockRestore();
		stdoutWriteSpy.mockRestore();
		processExitSpy.mockRestore();
		createInterfaceSpy.mockRestore();
	});

	it("should complete interactive picker login for Ollama local (provider 3)", async () => {
		// Ollama (Local) is index 2 (choice "3"). It requires no API key,
		// so the flow is: pick → accept default base URL → save.
		const answers = ["3", ""];
		let answerIndex = 0;

		const originalIsTTY = process.stdin.isTTY;
		process.stdin.isTTY = false;

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
			() =>
				({
					question: (_q: string, cb: (answer: string) => void) => {
						queueMicrotask(() => cb(answers[answerIndex++] ?? ""));
					},
					close: () => {},
				}) as unknown as readline.Interface
		);

		await expect(handleLogin([])).rejects.toThrow("exit");

		// Should have shown the Ollama note (no API key needed)
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("no API key needed"));
		// Should have saved the configuration
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Saved Ollama (Local) configuration"));
		// Should auto-set the default model (no existing default in empty config)
		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Default model set to: qwen3-coder"));
		expect(processExitSpy).toHaveBeenCalledWith(0);

		// Verify the config file was written with the base URL and default model
		const written = await readFile(TEMP_CONFIG_FILE, "utf-8");
		expect(written).toContain("http://localhost:11434");
		expect(written).toContain("qwen3-coder");

		process.stdin.isTTY = originalIsTTY;
		consoleLogSpy.mockRestore();
		stdoutWriteSpy.mockRestore();
		processExitSpy.mockRestore();
		createInterfaceSpy.mockRestore();
	});

	it("should exit with error for an invalid picker choice", async () => {
		const answers = ["99"];
		let answerIndex = 0;

		const originalIsTTY = process.stdin.isTTY;
		process.stdin.isTTY = false;

		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("exit");
		});
		const createInterfaceSpy = vi.spyOn(readline, "createInterface").mockImplementation(
			() =>
				({
					question: (_q: string, cb: (answer: string) => void) => {
						queueMicrotask(() => cb(answers[answerIndex++] ?? ""));
					},
					close: () => {},
				}) as unknown as readline.Interface
		);

		await expect(handleLogin([])).rejects.toThrow("exit");

		expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid choice"));
		expect(processExitSpy).toHaveBeenCalledWith(1);

		// Config file should NOT have been written
		expect(existsSync(TEMP_CONFIG_FILE)).toBe(false);

		process.stdin.isTTY = originalIsTTY;
		consoleLogSpy.mockRestore();
		processExitSpy.mockRestore();
		createInterfaceSpy.mockRestore();
	});
});
