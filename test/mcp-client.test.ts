import { describe, expect, it } from "bun:test";
import type { McpServerConfig } from "@/config/schema.js";
import { McpClient } from "@/mcp/client.js";

describe("McpClient", () => {
	const testConfig: McpServerConfig = {
		command: "test-mcp-server",
		args: ["--test"],
		env: { PATH: "/usr/bin", TEST_VAR: "test" },
	};

	describe("constructor", () => {
		it("should initialize with name and config", () => {
			const client = new McpClient("test-server", testConfig);

			expect(client.name).toBe("test-server");
			expect(client.isConnected).toBe(false);
			expect(client.tools).toEqual([]);
		});
	});

	describe("environment filtering", () => {
		it("should filter environment variables to safe list", () => {
			const client = new McpClient("test", { command: "test", args: [] });
			const filtered = (
				client as unknown as {
					_filterSafeEnvVars(env?: Record<string, string>): Record<string, string>;
				}
			)._filterSafeEnvVars({
				PATH: "/usr/bin",
				HOME: "/home/user",
				SECRET_KEY: "should-be-filtered",
				NODE_ENV: "production",
			});

			expect(filtered.PATH).toBe("/usr/bin");
			expect(filtered.HOME).toBe("/home/user");
			expect(filtered.SECRET_KEY).toBeUndefined();
			expect(filtered.NODE_ENV).toBe("production");
		});

		it("should handle undefined environment", () => {
			const client = new McpClient("test", { command: "test", args: [] });
			const filtered = (
				client as unknown as {
					_filterSafeEnvVars(env?: Record<string, string>): Record<string, string>;
				}
			)._filterSafeEnvVars(undefined);

			expect(filtered).toEqual({});
		});

		it("should filter empty values", () => {
			const client = new McpClient("test", { command: "test", args: [] });
			const filtered = (
				client as unknown as {
					_filterSafeEnvVars(env?: Record<string, string>): Record<string, string>;
				}
			)._filterSafeEnvVars({
				PATH: "/usr/bin",
				EMPTY_VAR: "",
			});

			expect(filtered.PATH).toBe("/usr/bin");
			expect(filtered.EMPTY_VAR).toBeUndefined();
		});

		it("should include common safe environment variables", () => {
			const client = new McpClient("test", { command: "test", args: [] });
			const safeVars = [
				"PATH",
				"HOME",
				"USER",
				"LOGNAME",
				"SHELL",
				"LANG",
				"LANGUAGE",
				"LC_ALL",
				"LC_CTYPE",
				"TERM",
				"NODE_ENV",
				"TZ",
				"PWD",
				"EDITOR",
				"VISUAL",
				"PAGER",
				"BROWSER",
				"TMPDIR",
				"TEMP",
				"TMP",
			];

			const env: Record<string, string> = {};
			for (const v of safeVars) {
				env[v] = `value-${v}`;
			}
			env.UNSAFE_VAR = "should-not-appear";

			const filtered = (
				client as unknown as {
					_filterSafeEnvVars(env?: Record<string, string>): Record<string, string>;
				}
			)._filterSafeEnvVars(env);

			for (const v of safeVars) {
				expect(filtered[v]).toBe(`value-${v}`);
			}
			expect(filtered.UNSAFE_VAR).toBeUndefined();
		});
	});
});
