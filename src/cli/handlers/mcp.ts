import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { getConfigPath } from "../../config/loader.js";
import { isCommandAvailable } from "../../utils/command.js";

export async function handleMcp(args: string[]): Promise<void> {
  const subCommand = args[0] || "list";
  const configPath = getConfigPath();

  // Default MCP servers
  const defaultServers: Record<string, { command: string; args: string[] }> = {
    context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    serena: {
      command: "uvx",
      args: [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena-mcp-server",
        "--context",
        "ide",
        "--project",
        ".",
        "--open-web-dashboard",
        "false",
      ],
    },
  };

  // Helper to read/write config
  const readConfig = async (): Promise<Record<string, unknown>> => {
    if (!existsSync(configPath)) return {};
    const content = await readFile(configPath, "utf-8");
    const { parse: parseYaml } = await import("yaml");
    return (parseYaml(content) as Record<string, unknown>) || {};
  };

  const writeConfig = async (config: Record<string, unknown>): Promise<void> => {
    const { stringify: stringifyYaml } = await import("yaml");
    await writeFile(configPath, stringifyYaml(config), "utf-8");
  };

  // Read config once for all operations
  const fileConfig = await readConfig();
  const userServers = ((fileConfig.mcpServers || {}) as Record<string, unknown>) || {};
  const enabledServers = Object.keys(userServers);

  if (subCommand === "list") {
    console.log("MCP Servers");
    console.log("===========\n");

    const hasUserMcpConfig = enabledServers.length > 0;

    if (!hasUserMcpConfig) {
      console.log("No mcpServers configured. Using defaults:");
      console.log("(Set 'mcpServers: {}' in config to disable all)\n");
    }

    // Default servers
    console.log("Available MCP Servers:");
    for (const [name, serverConfig] of Object.entries(defaultServers)) {
      const isEnabled = enabledServers.includes(name);
      const status = isEnabled ? "● enabled" : "○ disabled";
      const argsStr = serverConfig.args.join(" ");
      console.log(`  ${status} ${name}`);
      console.log(`    Command: ${serverConfig.command} ${argsStr}`);

      if (!isCommandAvailable(serverConfig.command)) {
        console.log(
          `    ⚠ Command "${serverConfig.command}" not found. Install required dependency.`,
        );
      }
    }

    // User-added servers (not in defaults)
    const userAdded = Object.entries(userServers).filter(([name]) => !defaultServers[name]);
    if (userAdded.length > 0) {
      console.log("\nCustom Servers:");
      for (const [name, serverConfig] of userAdded) {
        const cfg = serverConfig as { command: string; args?: string[] };
        const argsStr = (cfg.args || []).join(" ");
        console.log(`  ● ${name}`);
        console.log(`    Command: ${cfg.command} ${argsStr}`);
        if (!isCommandAvailable(cfg.command)) {
          console.log(`    ⚠ Command "${cfg.command}" not found.`);
        }
      }
    }

    console.log("\nUse './tiny-agent mcp add <name> <command> [args...]' to add a server");
    console.log("Use './tiny-agent mcp enable <name>' to enable a default server");
    console.log("Use './tiny-agent mcp disable <name>' to disable a server");
    process.exit(0);
  }

  if (subCommand === "add") {
    const name = args[1];
    const command = args[2];

    if (!name || !command) {
      console.log("Usage: ./tiny-agent mcp add <name> <command> [args...]");
      console.log("Example: ./tiny-agent mcp add myserver npx -y @org/mcp-server");
      process.exit(1);
    }

    const serverArgs = args.slice(3);

    if (!isCommandAvailable(command)) {
      console.log(`⚠ Warning: Command "${command}" not found.`);
      console.log(
        `   The server "${name}" will not work until you install the required dependency.`,
      );
      console.log();
    }

    if (!fileConfig.mcpServers) fileConfig.mcpServers = {};
    (fileConfig.mcpServers as Record<string, unknown>)[name] = { command, args: serverArgs };
    await writeConfig(fileConfig);
    console.log(`Added MCP server: ${name}`);
    console.log(`  Command: ${command} ${serverArgs.join(" ")}`);
    process.exit(0);
  }

  if (subCommand === "enable") {
    const name = args[1];

    if (!name) {
      console.log("Usage: ./tiny-agent mcp enable <name>");
      console.log("Example: ./tiny-agent mcp enable serena");
      process.exit(1);
    }

    if (!defaultServers[name]) {
      console.log(`Unknown MCP server: ${name}`);
      console.log("Available: context7, serena");
      process.exit(1);
    }

    const serverConfig = defaultServers[name];

    if (!isCommandAvailable(serverConfig.command)) {
      console.log(`⚠ Warning: Command "${serverConfig.command}" not found.`);
      console.log(
        `   The server "${name}" will not work until you install the required dependency.`,
      );
      console.log(`   For serena, install uv: curl -LsSf https://astral.sh/uv/install.sh | sh`);
      console.log();
    }

    if (!fileConfig.mcpServers) fileConfig.mcpServers = {};
    (fileConfig.mcpServers as Record<string, unknown>)[name] = serverConfig;
    await writeConfig(fileConfig);
    console.log(`Enabled MCP server: ${name}`);
    process.exit(0);
  }

  if (subCommand === "disable") {
    const name = args[1];

    if (!name) {
      console.log("Usage: ./tiny-agent mcp disable <name>");
      process.exit(1);
    }

    if (!userServers[name]) {
      console.log(`MCP server "${name}" is not configured`);
      process.exit(1);
    }

    delete userServers[name];
    fileConfig.mcpServers = userServers;
    await writeConfig(fileConfig);
    console.log(`Disabled MCP server: ${name}`);
    process.exit(0);
  }

  console.log(`Unknown subcommand: ${subCommand}`);
  console.log("Usage: ./tiny-agent mcp [list|add|enable|disable]");
  process.exit(1);
}
