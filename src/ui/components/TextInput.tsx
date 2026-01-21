import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Type a message...",
  disabled = false,
}: TextInputProps): React.ReactElement {
  const [cursorPosition, setCursorPosition] = useState(value.length);

  useEffect(() => {
    setCursorPosition(value.length);
  }, [value.length]);

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        if (value.trim()) {
          onSubmit(value);
        }
        return;
      }

      if (key.escape) {
        onChange("");
        setCursorPosition(0);
        return;
      }

      if (key.leftArrow) {
        setCursorPosition((prev) => Math.max(0, prev - 1));
        return;
      }

      if (key.rightArrow) {
        setCursorPosition((prev) => Math.min(value.length, prev + 1));
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorPosition > 0) {
          const newValue = value.slice(0, cursorPosition - 1) + value.slice(cursorPosition);
          onChange(newValue);
          setCursorPosition((prev) => Math.max(0, prev - 1));
        }
        return;
      }

      if (key.ctrl || key.meta) {
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        const newValue = value.slice(0, cursorPosition) + input + value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition((prev) => prev + input.length);
      }
    },
    { isActive: !disabled },
  );

  const displayValue = value || placeholder;
  const isPlaceholder = !value;

  return (
    <Box>
      <Text color="green" bold>
        {"❯ "}
      </Text>
      {isPlaceholder ? (
        <Text color="gray">{placeholder}</Text>
      ) : (
        <>
          <Text>{displayValue.slice(0, cursorPosition)}</Text>
          <Text inverse>{displayValue[cursorPosition] ?? " "}</Text>
          <Text>{displayValue.slice(cursorPosition + 1)}</Text>
        </>
      )}
    </Box>
  );
}
