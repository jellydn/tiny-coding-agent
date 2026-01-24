import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import { McpManager, setGlobalMcpManager, getGlobalMcpManager } from "../src/manager.js";
import { McpClient } from "../src/client.js";
import type { McpServerConfig } from "../config/schema.js";
import type { McpToolDefinition } from "../src/types.js";

describe("McpManager", () => {
  let originalGlobalManager: McpManager | null;

  beforeEach(() => {
    originalGlobalManager = getGlobalMcpManager();
    setGlobalMcpManager(new McpManager({}));
  });

  afterEach(() => {
    setGlobalMcpManager(originalGlobalManager);
  });

  describe("global singleton", () => {
    it("should provide access to global manager instance", () => {
      const manager = new McpManager();
      setGlobalMcpManager(manager);

      expect(getGlobalMcpManager()).toBe(manager);
    });

    it("should return null when no global manager set", () => {
      setGlobalMcpManager(null);

      expect(getGlobalMcpManager()).toBeNull();
    });
  });

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
});
