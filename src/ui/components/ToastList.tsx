import React from "react";
import { Box, Text } from "ink";
import { useToastContext } from "../contexts/ToastContext.js";

export function ToastList(): React.ReactElement | null {
  const { toasts } = useToastContext();

  if (toasts.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {toasts.map((toast) => {
        let color = "gray";
        let icon = "ℹ";
        if (toast.type === "success") {
          color = "green";
          icon = "✓";
        } else if (toast.type === "warning") {
          color = "yellow";
          icon = "!";
        } else if (toast.type === "error") {
          color = "red";
          icon = "✗";
        }

        return (
          <Box key={toast.id}>
            <Text color={color}>
              {icon} {toast.message}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
