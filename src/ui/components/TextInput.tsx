import React, { useState, useEffect, useRef } from "react";
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
  const valueRef = useRef(value);
  const cursorRef = useRef(cursorPosition);

  // Keep refs synced with state
  useEffect(() => {
    valueRef.current = value;
    cursorRef.current = cursorPosition;
  }, [value, cursorPosition]);

  useInput(
    (input, key) => {
      if (disabled) return;

      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;

      if (key.return) {
        if (currentValue.trim()) {
          onSubmit(currentValue);
        }
        return;
      }

      if (key.escape) {
        onChange("");
        setCursorPosition(0);
        cursorRef.current = 0;
        return;
      }

      if (key.leftArrow) {
        const newPos = Math.max(0, currentCursor - 1);
        setCursorPosition(newPos);
        cursorRef.current = newPos;
        return;
      }

      if (key.rightArrow) {
        const newPos = Math.min(currentValue.length, currentCursor + 1);
        setCursorPosition(newPos);
        cursorRef.current = newPos;
        return;
      }

      if (key.backspace || key.delete) {
        if (currentCursor > 0) {
          const newValue = currentValue.slice(0, currentCursor - 1) + currentValue.slice(currentCursor);
          onChange(newValue);
          const newPos = Math.max(0, currentCursor - 1);
          setCursorPosition(newPos);
          cursorRef.current = newPos;
        }
        return;
      }

      if (key.ctrl || key.meta) {
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        const newValue = currentValue.slice(0, currentCursor) + input + currentValue.slice(currentCursor);
        onChange(newValue);
        const newPos = currentCursor + input.length;
        setCursorPosition(newPos);
        cursorRef.current = newPos;
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
