/**
 * Custom hook for command handling
 * Provides command registration, execution, and management
 */

import { useCallback } from "react";
import { MessageRole } from "../types/enums.js";
import type { Command } from "../components/CommandMenu.js";

interface UseCommandHandlerProps {
  onAddMessage: (role: MessageRole, content: string) => void;
  onClearMessages: () => void;
  onSetShowModelPicker: (show: boolean) => void;
  onExit: () => void;
}

export function useCommandHandler({
  onAddMessage,
  onClearMessages,
  onSetShowModelPicker,
  onExit,
}: UseCommandHandlerProps) {
  const handleCommand = useCallback(
    (commandName: string) => {
      switch (commandName) {
        case "/clear":
          onClearMessages();
          break;
        case "/exit":
          onExit();
          break;
        case "/help":
          process.stdout.write(
            "Available commands:\n/help - Show this help\n/clear - Clear conversation\n/model - Switch model\n/exit - Exit\n",
          );
          break;
        case "/model":
          onSetShowModelPicker(true);
          break;
        default:
          onAddMessage(MessageRole.ASSISTANT, `Command ${commandName} not implemented yet`);
      }
    },
    [onAddMessage, onClearMessages, onSetShowModelPicker, onExit],
  );

  const handleCommandSelect = useCallback(
    (command: Command) => {
      handleCommand(command.name);
    },
    [handleCommand],
  );

  const handleSlashCommand = useCallback(
    (commandText: string) => {
      const commandName = commandText.split(" ")[0];
      if (commandName) {
        handleCommand(commandName);
      }
    },
    [handleCommand],
  );

  return {
    handleCommandSelect,
    handleSlashCommand,
  };
}