/**
 * Custom hook for command handling
 * Provides command registration, execution, and management
 */

import { useCallback } from "react";
import { MessageRole } from "../types/enums.js";
import type { Command } from "../components/CommandMenu.js";
import type { Agent } from "../../core/agent.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseSkillFrontmatter } from "../../skills/parser.js";

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
            `Available skills:\n\n${skillDescriptions}\n\nUse /skill <name> to load a specific skill.`,
          );
        }
        return;
      }

      if (!agent) {
        onAddMessage(MessageRole.ASSISTANT, "Error: Agent not initialized. Cannot load skills.");
        return;
      }

      const skillRegistry = agent.getSkillRegistry();
      const skillMetadata = skillRegistry.get(skillName);

      if (!skillMetadata) {
        const availableSkills = Array.from(skillRegistry.keys()).join(", ");
        onAddMessage(
          MessageRole.ASSISTANT,
          `Skill not found: ${skillName}\n\nAvailable skills: ${availableSkills || "none"}`,
        );
        return;
      }

      try {
        const content = await fs.readFile(skillMetadata.location, "utf-8");

        let allowedTools: string[] | undefined;
        try {
          const parsed = parseSkillFrontmatter(content);
          allowedTools = parsed.frontmatter.allowedTools;
        } catch {
          console.warn(`[WARN] Could not parse frontmatter for skill: ${skillName}`);
        }

        if (allowedTools) {
          agent._setSkillRestriction(allowedTools);
          onAddMessage(
            MessageRole.ASSISTANT,
            `Loaded skill: **${skillName}**\nRestricted tools to: ${allowedTools.join(", ")}`,
          );
        } else {
          agent._clearSkillRestriction();
          onAddMessage(
            MessageRole.ASSISTANT,
            `Loaded skill: **${skillName}**\nAll tools available.`,
          );
        }

        const baseDir = path.dirname(skillMetadata.location);
        const wrappedContent = `<loaded_skill name="${skillName}" base_dir="${baseDir}">\n${content}\n</loaded_skill>`;

        onAddMessage(
          MessageRole.ASSISTANT,
          `Skill loaded successfully. The skill instructions are now active.\n\n${wrappedContent}`,
        );
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === "ENOENT") {
          onAddMessage(
            MessageRole.ASSISTANT,
            `Error: Skill file not found: ${skillMetadata.location}`,
          );
        } else {
          onAddMessage(MessageRole.ASSISTANT, `Error reading skill: ${error.message}`);
        }
      }
    },
    [agent, onAddMessage],
  );

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
  /help   - Show this help
  /clear  - Clear conversation
  /model  - Switch model
  /skill  - Load a skill or list available skills
  /exit   - Exit`,
          );
          break;
        case "/model":
          onSetShowModelPicker(true);
          break;
        case "/skill":
          handleSkillCommand(args);
          break;
        default:
          onAddMessage(MessageRole.ASSISTANT, `Unknown command: ${commandName}`);
      }
    },
    [onAddMessage, onClearMessages, onSetShowModelPicker, onExit, handleSkillCommand],
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
