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
  /exit   - Exit`,
          );
          break;
        case "/model":
          onSetShowModelPicker(true);
          break;
        default:
          onAddMessage(MessageRole.ASSISTANT, `Unknown command: ${commandName}`);
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
