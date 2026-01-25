import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";

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
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;
  const [value, setValue] = useState("");
  const valueRef = useRef(value);
  valueRef.current = value;

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

      queueMicrotask(() => {
        const currentValue = valueRef.current;

        if (
          key.backspace ||
          key.delete ||
          input === "\x7F" ||
          input === "\b" ||
          input === "\x1b[3~"
        ) {
          const newValue = currentValue.slice(0, -1);
          setValue(newValue);
          onChange(newValue);
          return;
        }

        if (key.return) {
          if (currentValue.trim()) {
            onSubmit(currentValue);
          }
          setValue("");
          return;
        }

        if (key.escape) {
          setValue("");
          onChange("");
          return;
        }

        if (input === "\t") {
          const newValue = currentValue + "\t";
          setValue(newValue);
          onChange(newValue);
          return;
        }

        if (input === " ") {
          const newValue = currentValue + " ";
          setValue(newValue);
          onChange(newValue);
          return;
        }

        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          const newValue = currentValue + input;
          setValue(newValue);
          onChange(newValue);
        }
      });
    },
    [disabled, onChange, onSubmit],
  );

  useInput(handleInput, { isActive: !disabled });

  return (
    <Box width={terminalWidth}>
      <Text color="green" bold>
        {"> "}
      </Text>
      {value ? <Text>{value}</Text> : <Text color="gray">{placeholder}</Text>}
    </Box>
  );
}
