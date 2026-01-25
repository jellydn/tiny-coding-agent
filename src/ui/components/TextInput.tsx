import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

interface TextInputProps {
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function TextInput({
  onChange,
  onSubmit,
  placeholder = "Type a message...",
  disabled = false,
}: TextInputProps): React.ReactElement {
  const [value, setValue] = useState("");

  // Use functional state update to avoid closure issues
  const handleInput = useCallback(
    (
      input: string,
      key: {
        backspace?: boolean;
        return?: boolean;
        escape?: boolean;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
        delete?: boolean;
      },
    ) => {
      if (disabled) return;

      // Handle backspace and delete keys
      if (
        key.backspace ||
        key.delete ||
        input === "\x7F" ||
        input === "\b" ||
        input === "\x1b[3~"
      ) {
        setValue((prev) => {
          const newValue = prev.slice(0, -1);
          onChange(newValue);
          return newValue;
        });
        return;
      }

      // Handle return/submit
      if (key.return) {
        setValue((prev) => {
          if (prev.trim()) {
            onSubmit(prev);
          }
          return "";
        });
        return;
      }

      // Handle escape - clear input
      if (key.escape) {
        setValue("");
        onChange("");
        return;
      }

      // Handle tab - insert tab character
      if (input === "\t") {
        setValue((prev) => {
          const newValue = prev + "\t";
          onChange(newValue);
          return newValue;
        });
        return;
      }

      // Handle space
      if (input === " ") {
        setValue((prev) => {
          const newValue = prev + " ";
          onChange(newValue);
          return newValue;
        });
        return;
      }

      // Handle regular character input (ignore ctrl/meta key combinations)
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setValue((prev) => {
          const newValue = prev + input;
          onChange(newValue);
          return newValue;
        });
      }
    },
    [disabled, onChange, onSubmit],
  );

  useInput(handleInput, { isActive: !disabled });

  return (
    <Box>
      <Text color="green" bold>
        {"❯ "}
      </Text>
      {value ? <Text>{value}</Text> : <Text color="gray">{placeholder}</Text>}
    </Box>
  );
}
