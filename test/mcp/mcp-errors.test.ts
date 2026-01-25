import { describe, expect, it, vi } from "bun:test";
import type { McpServerConfig } from "../../src/config/schema.js";
import { McpClient } from "../../src/mcp/client.js";
import { McpManager } from "../../src/mcp/manager.js";

describe("MCP Server Error Scenarios", () => {
	describe("McpClient - connection errors", () => {
		it("should initialize with disconnected state", () => {
			const client = new McpClient("test-server", {
				command: "echo",
				args: ["test"],
			});

			expect(client.name).toBe("test-server");
			expect(client.isConnected).toBe(false);
			expect(client.tools).toEqual([]);
		});

		it("should throw descriptive error on connection failure", async () => {
			const client = new McpClient("failing-server", {
				command: "nonexistent-command-xyz",
				args: [],
			});

			await expect(client.connect()).rejects.toThrow(/Failed to connect/);
			expect(client.isConnected).toBe(false);
		});
	});

	describe("McpClient - disconnection", () => {
		it("should handle disconnect when not connected", async () => {
			const client = new McpClient("test", { command: "echo", args: [] });

			let threw = false;
			try {
				await client.disconnect();
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});
	});

	describe("McpClient - environment filtering", () => {
		it("should filter dangerous environment variables", () => {
			const client = new McpClient("test", { command: "echo", args: [] });
			const filtered = (
				client as unknown as {
					_filterSafeEnvVars(env?: Record<string, string>): Record<string, string>;
				}
			)._filterSafeEnvVars({
				PATH: "/usr/bin",
				HOME: "/home/user",
				SECRET_KEY: "should-be-filtered",
				API_KEY: "should-be-filtered",
				NODE_ENV: "production",
			});

			expect(filtered.PATH).toBe("/usr/bin");
			expect(filtered.HOME).toBe("/home/user");
			expect(filtered.SECRET_KEY).toBeUndefined();
			expect(filtered.API_KEY).toBeUndefined();
			expect(filtered.NODE_ENV).toBe("production");
		});

		it("should handle undefined environment", () => {
			const client = new McpClient("test", { command: "echo", args: [] });
			const filtered = (
				client as unknown as {
					_filterSafeEnvVars(env?: Record<string, string>): Record<string, string>;
				}
			)._filterSafeEnvVars(undefined);

			expect(filtered).toEqual({});
		});

		it("should filter empty string values", () => {
			const client = new McpClient("test", { command: "echo", args: [] });
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
	});

	describe("McpManager - server management", () => {
		it("should create manager with empty state", () => {
			const manager = new McpManager();

			const status = manager.getServerStatus();
			expect(status).toEqual([]);
			expect(manager.getConnections()).toEqual([]);
		});

		it("should create manager with verbose option", () => {
			const manager = new McpManager({ verbose: true });
			const status = manager.getServerStatus();
			expect(status).toEqual([]);
		});

		it("should create manager with disabled patterns", () => {
			const manager = new McpManager({ disabledPatterns: ["test-*"] });
			const status = manager.getServerStatus();
			expect(status).toEqual([]);
		});

		it("should reject duplicate server names", async () => {
			const manager = new McpManager();
			const config: McpServerConfig = { command: "echo", args: [] };

			const result1 = await manager.addServer("test", config);
			const result2 = await manager.addServer("test", config);

			expect(result1).toBe(true);
			expect(result2).toBe(false);
		});

		it("should return false for unavailable command", async () => {
			const manager = new McpManager();
			const config: McpServerConfig = {
				command: "nonexistent-command-xyz-123",
				args: [],
			};

			const result = await manager.addServer("unavailable", config);

			expect(result).toBe(false);
		});

		it("should handle removing non-existent server gracefully", async () => {
			const manager = new McpManager();

			let threw = false;
			try {
				await manager.removeServer("nonexistent");
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});

		it("should report not connected for unknown server", () => {
			const manager = new McpManager();

			expect(manager.isServerConnected("unknown")).toBe(false);
		});

		it("should return empty tools for unknown server", () => {
			const manager = new McpManager();

			const tools = manager.getTools("unknown");
			expect(tools).toEqual([]);
		});
	});

	describe("McpManager - callTool error handling", () => {
		it("should return error when server does not exist", async () => {
			const manager = new McpManager();

			const result = await manager.callTool("nonexistent", "someTool", { arg: "value" });

			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});

		it("should return error for unknown tool", async () => {
			const manager = new McpManager();
			const config: McpServerConfig = { command: "echo", args: [] };
			await manager.addServer("test", config);

			const result = await manager.callTool("test", "unknownTool", {});

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("McpManager - server status", () => {
		it("should return empty status for no servers", () => {
			const manager = new McpManager();

			const status = manager.getServerStatus();

			expect(status).toEqual([]);
		});

		it("should include server info in status", async () => {
			const manager = new McpManager();
			const config: McpServerConfig = { command: "echo", args: [] };
			await manager.addServer("test", config);

			const status = manager.getServerStatus();

			expect(status.length).toBeGreaterThan(0);
			expect(status[0]).toHaveProperty("name");
			expect(status[0]).toHaveProperty("connected");
			expect(status[0]).toHaveProperty("toolCount");
		});

		it("should filter tool count based on disabled patterns", async () => {
			const manager = new McpManager({ disabledPatterns: ["test-*"] });
			const config: McpServerConfig = { command: "echo", args: [] };
			await manager.addServer("test", config);

			const status = manager.getServerStatus();

			expect(status.length).toBe(1);
			expect(status[0]?.toolCount).toBe(0);
		});
	});

	describe("McpManager - createToolFromMcp", () => {
		it("should create tool with prefixed name", () => {
			const manager = new McpManager();
			const toolDef = {
				name: "list-files",
				description: "List files in directory",
				inputSchema: {
					type: "object" as const,
					properties: { path: { type: "string" as const } },
					required: ["path"],
				},
			};

			const tool = manager.createToolFromMcp("fileserver", toolDef);

			expect(tool.name).toBe("mcp_fileserver_list-files");
			expect(tool.description).toContain("[MCP: fileserver]");
			expect(tool.dangerous).toContain("fileserver");
		});

		it("should include parameters in created tool", () => {
			const manager = new McpManager();
			const toolDef = {
				name: "read",
				description: "Read a file",
				inputSchema: {
					type: "object" as const,
					properties: { path: { type: "string" as const }, encoding: { type: "string" as const } },
					required: ["path"],
				},
			};

			const tool = manager.createToolFromMcp("server", toolDef);

			expect(tool.parameters).toBeDefined();
			expect((tool.parameters as unknown as Record<string, unknown>).type).toBe("object");
		});
	});

	describe("McpManager - disconnectAll", () => {
		it("should clear all connections", async () => {
			const manager = new McpManager();
			const config: McpServerConfig = { command: "echo", args: [] };
			await manager.addServer("test", config);

			await manager.disconnectAll();

			expect(manager.getConnections()).toEqual([]);
			expect(manager.getServerStatus()).toEqual([]);
		});
	});

	describe("McpManager - verbose logging", () => {
		it("should log warnings when verbose is enabled and command unavailable", async () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			try {
				const manager = new McpManager({ verbose: true });
				const config: McpServerConfig = { command: "nonexistent-command-xyz", args: [] };
				await manager.addServer("test", config);

				expect(consoleSpy).toHaveBeenCalled();
			} finally {
				consoleSpy.mockRestore();
			}
		});

		it("should not log when verbose is disabled", async () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			try {
				const manager = new McpManager({ verbose: false });
				const config: McpServerConfig = { command: "nonexistent-command-xyz", args: [] };
				await manager.addServer("test", config);

				expect(consoleSpy).not.toHaveBeenCalled();
			} finally {
				consoleSpy.mockRestore();
			}
		});
	});

	describe("McpManager - multiple servers", () => {
		it("should handle multiple server additions", async () => {
			const manager = new McpManager();
			const config: McpServerConfig = { command: "echo", args: [] };

			await manager.addServer("server1", config);
			await manager.addServer("server2", config);

			const status = manager.getServerStatus();
			expect(status.length).toBe(2);
		});

		it("should handle rapid add/remove operations", async () => {
			const manager = new McpManager();
			const config: McpServerConfig = { command: "echo", args: [] };

			await manager.addServer("server1", config);
			await manager.addServer("server2", config);
			await manager.removeServer("server1");
			await manager.addServer("server1", config);

			const status = manager.getServerStatus();
			expect(status.length).toBe(2);
			const server1 = status.find((s) => s.name === "server1");
			expect(server1).toBeDefined();
		});
	});
});
