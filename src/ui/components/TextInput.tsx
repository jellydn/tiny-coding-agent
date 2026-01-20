import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { CommandMenu, type Command } from "./CommandMenu.js";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCommandSelect?: (command: Command) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  onCommandSelect,
  placeholder = "",
  disabled = false,
}: TextInputProps): React.ReactElement {
  const [cursorPosition, setCursorPosition] = useState(value.length);
  const showCommandMenu = !disabled && value.startsWith("/");
  const commandFilter = showCommandMenu ? value.slice(1) : "";

  useInput(
    (input, key) => {
      if (disabled) return;

      if (showCommandMenu) {
        if (key.escape) {
          onChange("");
          setCursorPosition(0);
        }
        return;
      }

      if (key.return) {
        if (value.trim()) {
          onSubmit(value);
        }
      } else if (key.ctrl || key.meta) {
        return;
      } else if (key.backspace || key.delete) {
        if (key.backspace) {
          if (cursorPosition > 0) {
            const newValue = value.slice(0, cursorPosition - 1) + value.slice(cursorPosition);
            onChange(newValue);
            setCursorPosition(cursorPosition - 1);
          }
        } else if (key.delete && cursorPosition < value.length) {
          const newValue = value.slice(0, cursorPosition) + value.slice(cursorPosition + 1);
          onChange(newValue);
        }
      } else if (key.leftArrow) {
        setCursorPosition((prev) => Math.max(0, prev - 1));
      } else if (key.rightArrow) {
        setCursorPosition((prev) => Math.min(value.length, prev + 1));
      } else if (key.escape) {
        onChange("");
        setCursorPosition(0);
      } else if (input) {
        const newValue = value.slice(0, cursorPosition) + input + value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(cursorPosition + 1);
      }
    },
    { isActive: !disabled },
  );

  const handleCommandSelect = (command: Command) => {
    if (onCommandSelect) {
      onCommandSelect(command);
    }
    onChange("");
    setCursorPosition(0);
  };

  const displayValue = value || placeholder;
  const showCursor = !disabled && cursorPosition <= displayValue.length;

  return (
    <Box flexDirection="column">
      {showCommandMenu && (
        <Box marginBottom={1}>
          <CommandMenu
            filter={commandFilter}
            onSelect={handleCommandSelect}
            onClose={() => onChange("")}
          />
        </Box>
      )}
      <Box>
        <Text color="gray">{"> "}</Text>
        <Text>{displayValue.slice(0, cursorPosition)}</Text>
        {showCursor && <Text inverse>{displayValue[cursorPosition] ?? " "}</Text>}
        <Text>{displayValue.slice(cursorPosition + 1)}</Text>
      </Box>
    </Box>
  );
}
