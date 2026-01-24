/**
 * Custom hook for command handling
 * Provides command registration, execution, and management
 */

import { useCallback } from "react";
import { MessageRole } from "../types/enums.js";
import type { Command } from "../components/CommandMenu.js";
import type { Agent } from "../../core/agent.js";
import { getGlobalMcpManager } from "../../mcp/manager.js";

interface UseCommandHandlerProps {
  onAddMessage: (role: MessageRole, content: string) => void;
  onClearMessages: () => void;
  onSetShowModelPicker: (show: boolean) => void;
  onExit: () => void;
  agent?: Agent;
}

export function useCommandHandler({
  onAddMessage,
  onClearMessages,
  onSetShowModelPicker,
  onExit,
  agent,
}: UseCommandHandlerProps) {
  const handleSkillCommand = useCallback(
    async (args: string) => {
      const skillName = args.trim();

      if (!skillName) {
        if (!agent) {
          onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot list skills.");
          return;
        }

        const skills = agent.getSkillRegistry();
        const skillList = Array.from(skills.values());

        if (skillList.length === 0) {
          onAddMessage(
            MessageRole.ASSISTANT,
            `No skills available.\n\nUse "tiny-agent skill init <name>" to create a new skill, or configure skillDirectories in your config.yaml.`,
          );
        } else {
          const skillDescriptions = skillList
            .map((s) => `  • **${s.name}**: ${s.description}`)
            .join("\n");
          onAddMessage(
            MessageRole.ASSISTANT,
            `Available skills:\n\n${skillDescriptions}\n\nType @skill-name to load a skill.`,
          );
        }
        return;
      }

      if (!agent) {
        onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot load skills.");
        return;
      }

      const skillRegistry = agent.getSkillRegistry();

      if (!skillRegistry.has(skillName)) {
        const availableSkills = Array.from(skillRegistry.keys()).join(", ");
        onAddMessage(
          MessageRole.ASSISTANT,
          `Skill not found: ${skillName}\n\nAvailable skills: ${availableSkills || "none"}\n\nType @skill-name to load a skill.`,
        );
        return;
      }

      try {
        const result = await agent.loadSkill(skillName);
        if (!result) {
          const availableSkills = Array.from(skillRegistry.keys()).join(", ");
          onAddMessage(
            MessageRole.ASSISTANT,
            `Skill not found: ${skillName}\n\nAvailable skills: ${availableSkills || "none"}`,
          );
          return;
        }

        const { wrappedContent, allowedTools } = result;
        if (allowedTools) {
          onAddMessage(
            MessageRole.ASSISTANT,
            `Loaded skill: **${skillName}**\nRestricted tools to: ${allowedTools.join(", ")}\n\n${wrappedContent}`,
          );
        } else {
          onAddMessage(
            MessageRole.ASSISTANT,
            `Loaded skill: **${skillName}**\nAll tools available.\n\n${wrappedContent}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onAddMessage(MessageRole.ASSISTANT, `Error loading skill: ${message}`);
      }
    },
    [agent, onAddMessage],
  );

  const handleMcpCommand = useCallback(() => {
    const mcpManager = getGlobalMcpManager();
    if (!mcpManager) {
      onAddMessage(MessageRole.ASSISTANT, "No MCP servers configured.");
      return;
    }

    const servers = mcpManager.getServerStatus();
    if (servers.length === 0) {
      onAddMessage(MessageRole.ASSISTANT, "No MCP servers registered.");
      return;
    }

    const lines = servers
      .map((s) => {
        const status = s.connected ? "●" : "○";
        const tools = s.toolCount > 0 ? ` (${s.toolCount} tools)` : "";
        return `  ${status} ${s.name}${tools}`;
      })
      .join("\n");

    onAddMessage(
      MessageRole.ASSISTANT,
      `MCP Servers:\n\n${lines}\n\nUse a tool from an MCP server to connect it.`,
    );
  }, [onAddMessage]);

  const handleMemoryCommand = useCallback(() => {
    if (!agent) {
      onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized.");
      return;
    }

    const memoryStore = agent.getMemoryStore();
    if (!memoryStore) {
      onAddMessage(MessageRole.ASSISTANT, "Memory not configured. Set memoryFile in config.yaml.");
      return;
    }

    const memories = memoryStore.list();
    if (memories.length === 0) {
      onAddMessage(MessageRole.ASSISTANT, "No memories stored.");
    } else {
      const list = memories.map((m) => `  • [${m.category}] ${m.content}`).join("\n");
      onAddMessage(MessageRole.ASSISTANT, `Memories:\n\n${list}`);
    }
  }, [agent, onAddMessage]);

  const handleCommand = useCallback(
    (commandName: string, args: string = "") => {
      switch (commandName) {
        case "/clear":
          onClearMessages();
          onAddMessage(MessageRole.ASSISTANT, "Conversation cleared.");
          break;
        case "/exit":
          onExit();
          break;
        case "/help":
          onAddMessage(
            MessageRole.ASSISTANT,
            `Available commands:
  /help    - Show this help
  /clear   - Clear conversation
  /model   - Switch model
  /mcp     - Show MCP server status
  /memory  - List memories
  /skill   - List skills
  /exit    - Exit`,
          );
          break;
        case "/model":
          onSetShowModelPicker(true);
          break;
        case "/mcp":
          handleMcpCommand();
          break;
        case "/skill":
          handleSkillCommand(args);
          break;
        case "/memory":
          handleMemoryCommand();
          break;
        default:
          onAddMessage(MessageRole.ASSISTANT, `Unknown command: ${commandName}`);
      }
    },
    [
      onAddMessage,
      onClearMessages,
      onSetShowModelPicker,
      onExit,
      handleSkillCommand,
      handleMcpCommand,
      handleMemoryCommand,
    ],
  );

  const handleCommandSelect = useCallback(
    (command: Command) => {
      const parts = command.name.split(" ");
      const commandName = (parts[0] ?? "") as string;
      const args = parts.length > 1 ? parts.slice(1).join(" ") : "";
      handleCommand(commandName, args);
    },
    [handleCommand],
  );

  const handleSlashCommand = useCallback(
    (commandText: string) => {
      const parts = commandText.trim().split(/\s+/);
      const commandName = parts[0] || "";
      const args = parts.slice(1).join(" ");
      if (commandName) {
        handleCommand(commandName, args);
      }
    },
    [handleCommand],
  );

  return {
    handleCommandSelect,
    handleSlashCommand,
  };
}
