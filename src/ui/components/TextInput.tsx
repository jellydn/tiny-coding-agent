import React, { useState } from "react";
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
  placeholder = "",
  disabled = false,
}: TextInputProps): React.ReactElement {
  const [cursorPosition, setCursorPosition] = useState(value.length);

  useInput(
    (input, key) => {
      if (disabled) return;

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

  const displayValue = value || placeholder;
  const showCursor = !disabled && cursorPosition <= displayValue.length;

  return (
    <Box>
      <Text color="gray">{"> "}</Text>
      <Text>{displayValue.slice(0, cursorPosition)}</Text>
      {showCursor && <Text inverse>{displayValue[cursorPosition] ?? " "}</Text>}
      <Text>{displayValue.slice(cursorPosition + 1)}</Text>
    </Box>
  );
}
