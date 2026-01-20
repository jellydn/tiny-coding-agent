import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";

export interface Command {
  name: string;
  description: string;
}

interface CommandMenuProps {
  filter?: string;
  onSelect: (command: Command) => void;
  onClose: () => void;
}

const COMMANDS: Command[] = [
  { name: "/help", description: "Show available commands" },
  { name: "/clear", description: "Clear the conversation" },
  { name: "/model", description: "Switch the model" },
  { name: "/memory", description: "Manage memories" },
  { name: "/exit", description: "Exit the session" },
];

export function CommandMenu({
  filter = "",
  onSelect,
  onClose,
}: CommandMenuProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const prevFilterRef = useRef(filter);

  const filteredCommands = COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(filter.toLowerCase()),
  );

  useEffect(() => {
    if (filter !== prevFilterRef.current) {
      prevFilterRef.current = filter;
      setSelectedIndex(0);
    }
  }, [filter]);

  useInput(
    (input, key) => {
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
      } else if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (key.return) {
        const selectedCommand = filteredCommands[selectedIndex];
        if (selectedCommand) {
          onSelect(selectedCommand);
        }
      } else if (key.escape) {
        onClose();
      }
    },
    { isActive: true },
  );

  if (filteredCommands.length === 0) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
        <Text color="gray">No commands found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
      {filteredCommands.map((cmd, index) => (
        <Box key={cmd.name}>
          <Text>
            {index === selectedIndex ? (
              <Text inverse color="blue">
                {" "}
                ▼{" "}
              </Text>
            ) : (
              <Text> </Text>
            )}
          </Text>
          <Text bold color={index === selectedIndex ? "blue" : undefined}>
            {cmd.name}
          </Text>
          <Text color="gray"> {cmd.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
