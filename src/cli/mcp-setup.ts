/**
 * mcp-setup.ts — MCP server initialization for tiny-coding-agent.
 *
 * Extracted from shared.ts (Round 7 Candidate #4) so the MCP startup
 * sequence is testable and shared.ts focuses on CLI orchestration.
 */

import type { Config, McpServerConfig } from "../config/schema.js";
import { globToRegex, McpManager } from "../mcp/manager.js";
import type { ToolRegistry } from "../tools/registry.js";
import { statusLineManager } from "../ui/index.js";

/**
 * Configure and start all MCP servers from a Config, then register their
 * tools into the supplied ToolRegistry.
 *
 * @returns The McpManager if any servers were configured, or undefined.
 */
export async function setupMcpServers(config: Config, registry: ToolRegistry): Promise<McpManager | undefined> {
	if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
		return undefined;
	}

	const mcpManager = new McpManager({ disabledPatterns: config.disabledMcpPatterns ?? [] });

	for (const [name, cfg] of Object.entries(config.mcpServers) as [string, McpServerConfig][]) {
		await mcpManager.addServer(name, cfg);
	}

	const allTools = mcpManager.getAllTools();
	for (const [server, toolDefs] of allTools) {
		for (const toolDef of toolDefs) {
			const tool = mcpManager.createToolFromMcp(server, toolDef);
			if (isToolEnabled(config, tool.name)) {
				try {
					registry.register(tool);
				} catch (err) {
					console.error(`Warning: Failed to register MCP tool: ${(err as Error).message}`);
				}
			}
		}
	}

	const connected = mcpManager.getServerStatus().filter((s) => s.connected && s.toolCount > 0).length;
	statusLineManager.setMcpServerCount(connected);

	return mcpManager;
}

/**
 * Check whether a tool name should be enabled based on the config's
 * disabled-MCP patterns and per-tool overrides.
 */
function isToolEnabled(config: Config, name: string): boolean {
	const isMcpDisabled = (toolName: string): boolean =>
		config.disabledMcpPatterns?.length && toolName.startsWith("mcp_")
			? config.disabledMcpPatterns.some((p) => globToRegex(p).test(toolName))
			: false;

	return (
		!isMcpDisabled(name) &&
		(config.tools === undefined || config.tools[name] === undefined || config.tools[name]?.enabled)
	);
}
