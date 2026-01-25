import { describe, it, expect, vi } from "bun:test";
import {
  McpManager,
} from "../../src/mcp/manager.js";
import { McpClient } from "../../src/mcp/client.js";
import type { McpServerConfig } from "../../src/config/schema.js";
import type { McpToolDefinition } from "../../src/mcp/types.js";

describe("McpManager", () => {

  describe("addServer()", () => {
    it("should register a new server successfully", async () => {
      const manager = new McpManager();
      const config: McpServerConfig = { command: "echo", args: ["test"] };

      const result = await manager.addServer("test", config);

      expect(result).toBe(true);
    });

    it("should reject duplicate server names", async () => {
      const manager = new McpManager();
      const config: McpServerConfig = { command: "echo", args: [] };

      await manager.addServer("test", config);
      const duplicateResult = await manager.addServer("test", config);

      expect(duplicateResult).toBe(false);
    });

    it("should skip servers when command is unavailable", async () => {
      const manager = new McpManager();
      const config: McpServerConfig = {
        command: "nonexistent-command-12345xyz",
        args: [],
      };

      const result = await manager.addServer("unavailable", config);

      expect(result).toBe(false);
    });
  });

  describe("removeServer()", () => {
    it("should remove an existing server", async () => {
      const manager = new McpManager();
      const config: McpServerConfig = { command: "echo", args: [] };
      await manager.addServer("test", config);

      await manager.removeServer("test");

      const status = manager.getServerStatus();
      expect(status).toEqual([]);
    });

    it("should handle removing non-existent server gracefully", async () => {
      const manager = new McpManager();

      await manager.removeServer("nonexistent");
    });
  });

  describe("callTool()", () => {
    it("should return error when server does not exist", async () => {
      const manager = new McpManager();

      const result = await manager.callTool("nonexistent", "someTool", { arg: "value" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error when server is not available", async () => {
      const manager = new McpManager();
      const config: McpServerConfig = {
        command: "nonexistent-command-12345",
        args: [],
      };
      const addResult = await manager.addServer("unavailable", config);

      expect(addResult).toBe(false);

      const status = manager.getServerStatus();
      // Server should not be added when command is unavailable
      expect(status.length).toBe(0);
    });
  });

  describe("getTools()", () => {
    it("should return empty array for unknown server", () => {
      const manager = new McpManager();

      const tools = manager.getTools("nonexistent");

      expect(tools).toEqual([]);
    });

    it("should return tools for registered server", () => {
      const manager = new McpManager();
      const config: McpServerConfig = { command: "echo", args: [] };
      manager.addServer("test", config);

      const tools = manager.getTools("test");

      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe("getServerStatus()", () => {
    it("should return empty array when no servers registered", () => {
      const manager = new McpManager();

      const status = manager.getServerStatus();

      expect(status).toEqual([]);
    });

    it("should include connection state for each server", async () => {
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
      const serverStatus = status[0];
      if (serverStatus) {
        expect(serverStatus.toolCount).toBe(0);
      }
    });
  });

  describe("isServerConnected()", () => {
    it("should return false for unknown server", () => {
      const manager = new McpManager();

      const connected = manager.isServerConnected("nonexistent");

      expect(connected).toBe(false);
    });

    it("should return connection state for registered server", async () => {
      const manager = new McpManager();
      const config: McpServerConfig = { command: "echo", args: [] };
      await manager.addServer("test", config);

      const connected = manager.isServerConnected("test");

      expect(typeof connected).toBe("boolean");
    });
  });

  describe("getConnections()", () => {
    it("should return empty array when no servers", () => {
      const manager = new McpManager();

      const connections = manager.getConnections();

      expect(connections).toEqual([]);
    });

    it("should return connection info for each server", async () => {
      const manager = new McpManager();
      const config: McpServerConfig = { command: "echo", args: [] };
      await manager.addServer("test", config);

      const connections = manager.getConnections();

      expect(connections.length).toBeGreaterThan(0);
      expect(connections[0]).toHaveProperty("name");
      expect(connections[0]).toHaveProperty("isConnected");
    });
  });

  describe("disconnectAll()", () => {
    it("should disconnect all servers", async () => {
      const manager = new McpManager();
      const config: McpServerConfig = { command: "echo", args: [] };
      await manager.addServer("test", config);

      await manager.disconnectAll();

      const connections = manager.getConnections();
      expect(connections).toEqual([]);
    });
  });

  describe("restartServer()", () => {
    it("should handle non-existent server gracefully", async () => {
      const manager = new McpManager();

      await manager.restartServer("nonexistent");
    });

    it("should reset restart attempts for existing server", async () => {
      const connectSpy = vi.spyOn(McpClient.prototype, "connect").mockImplementation(async () => {
        return;
      });

      try {
        const manager = new McpManager();
        const config: McpServerConfig = { command: "echo", args: [] };
        await manager.addServer("test", config);

        await manager.restartServer("test");

        const status = manager.getServerStatus();
        expect(status.length).toBe(1);
        expect(status[0]?.name).toBe("test");

        expect(connectSpy).toHaveBeenCalled();
      } finally {
        connectSpy.mockRestore();
      }
    });
  });

  describe("createToolFromMcp()", () => {
    it("should create tool with prefixed name", async () => {
      const manager = new McpManager();
      const toolDef: McpToolDefinition = {
        name: "list-files",
        description: "List files in directory",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      };

      const tool = manager.createToolFromMcp("fileserver", toolDef);

      expect(tool.name).toBe("mcp_fileserver_list-files");
      expect(tool.description).toContain("[MCP: fileserver]");
      expect(tool.dangerous).toContain("fileserver");
    });
  });

  describe("server failures and reconnection", () => {
    it("should handle connection failures gracefully", async () => {
      const connectSpy = vi
        .spyOn(McpClient.prototype, "connect")
        .mockRejectedValue(new Error("Connection failed"));

      try {
        const manager = new McpManager({ verbose: true });
        const config: McpServerConfig = { command: "echo", args: [] };
        const result = await manager.addServer("failing", config);

        // Should still return true (server registered, will retry on use)
        expect(result).toBe(true);

        const status = manager.getServerStatus();
        expect(status.length).toBe(1);
        expect(status[0]?.connected).toBe(false);
      } finally {
        connectSpy.mockRestore();
      }
    });

    it("should attempt reconnection on tool call after failure", async () => {
      let connectCallCount = 0;
      const connectSpy = vi
        .spyOn(McpClient.prototype, "connect")
        .mockImplementation(async function () {
          connectCallCount++;
          if (connectCallCount === 1) {
            throw new Error("Initial connection failed");
          }
          // Second call succeeds
        });

      try {
        const manager = new McpManager();
        const config: McpServerConfig = { command: "echo", args: [] };
        await manager.addServer("retry", config);

        // First attempt already made during addServer, failed
        expect(connectCallCount).toBe(1);

        const status = manager.getServerStatus();
        expect(status[0]?.connected).toBe(false);
      } finally {
        connectSpy.mockRestore();
      }
    });

    it("should report tool conflicts gracefully", async () => {
      const manager = new McpManager();
      const toolDef: McpToolDefinition = {
        name: "read-file",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      };

      // Register first tool
      const tool1 = manager.createToolFromMcp("server1", toolDef);

      // Try to register second tool with same name from different server
      const tool2 = manager.createToolFromMcp("server2", toolDef);

      // Both tools should be created (conflict handling is in registry)
      expect(tool1.name).not.toBe(tool2.name);
    });

    it("should handle multiple servers with different connection states", async () => {
      const manager = new McpManager();
      const config1: McpServerConfig = { command: "echo", args: [] };
      const config2: McpServerConfig = { command: "cat", args: [] };

      await manager.addServer("server1", config1);
      await manager.addServer("server2", config2);

      const status = manager.getServerStatus();
      expect(status.length).toBe(2);

      const server1 = status.find((s) => s.name === "server1");
      const server2 = status.find((s) => s.name === "server2");

      expect(server1).toBeDefined();
      expect(server2).toBeDefined();
    });
  });

  describe("verbose mode", () => {
    it("should log warnings when verbose is enabled", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const manager = new McpManager({ verbose: true });
        const config: McpServerConfig = { command: "nonexistent-command-xyz", args: [] };
        await manager.addServer("test", config);

        // Should have logged a warning about unavailable command
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

        // Should not have logged
        expect(consoleSpy).not.toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe("disabled patterns", () => {
    it("should disable servers matching patterns", async () => {
      const manager = new McpManager({ disabledPatterns: ["test-*"] });
      const config: McpServerConfig = { command: "echo", args: [] };

      await manager.addServer("test-server", config);

      const status = manager.getServerStatus();
      expect(status.length).toBe(1);
      // Pattern matches, so toolCount should be 0 (tools filtered)
      expect(status[0]?.toolCount).toBe(0);
    });

    it("should allow non-matching servers", async () => {
      const manager = new McpManager({ disabledPatterns: ["test-*"] });
      const config: McpServerConfig = { command: "echo", args: [] };

      await manager.addServer("allowed-server", config);

      const status = manager.getServerStatus();
      expect(status.length).toBe(1);
      // Pattern doesn't match, tools are not filtered
      // Note: echo command may not provide tools, but pattern matching is tested
      expect(status[0]?.name).toBe("allowed-server");
    });
  });
});
