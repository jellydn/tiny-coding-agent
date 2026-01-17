import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
import InkSpinner from "ink-spinner";

interface SpinnerProps {
  isLoading: boolean;
  label?: string;
}

export function Spinner({
  isLoading,
  label = "Thinking",
}: SpinnerProps): React.ReactElement | null {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setElapsed(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsed((Date.now() - startTime) / 1000);
    }, 100);

    return () => clearInterval(interval);
  }, [isLoading]);

  if (!isLoading) {
    return null;
  }

  return (
    <Box>
      <Text color="cyan">
        <InkSpinner type="dots" />
      </Text>
      <Text>
        {" "}
        {label}... {elapsed.toFixed(1)}s
      </Text>
    </Box>
  );
}
