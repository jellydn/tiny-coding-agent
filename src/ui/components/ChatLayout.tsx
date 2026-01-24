import type React from "react";
import { Box, Text } from "ink";
import { Header } from "./Header.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { StatusLine } from "./StatusLine.js";
import { TextInput } from "./TextInput.js";
import { CommandMenu, type Command } from "./CommandMenu.js";
import type { SkillMetadata } from "../../skills/types.js";
import {
  ModelPicker,
  DEFAULT_MODELS,
  getModelsForProviders,
  type EnabledProviders,
  type ModelPickerItem,
} from "./ModelPicker.js";
import { SkillPicker } from "./SkillPicker.js";
import { useStatusLine } from "../contexts/StatusLineContext.js";

interface ChatLayoutProps {
  messages: ChatMessage[];
  currentModel?: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputSubmit: (value: string) => void;
  onCommandSelect?: (command: Command) => void;
  onModelSelect?: (modelId: string) => void;
  onSkillSelect?: (skill: SkillMetadata) => void;
  inputPlaceholder?: string;
  inputDisabled?: boolean;
  showModelPicker?: boolean;
  enabledProviders?: EnabledProviders;
  skillItems?: SkillMetadata[];
}

function WelcomeMessage(): React.ReactElement {
  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
      <Text bold color="cyan">
        {`
     ┏┳┓•      ┏┓   ┓•      ┏┓
      ┃ ┓┏┓┓┏  ┃ ┏┓┏┫┓┏┓┏┓  ┣┫┏┓┏┓┏┓╋
      ┻ ┗┛┗┗┫  ┗┛┗┛┗┻┗┛┗┗┫  ┛┗┗┫┗ ┛┗┗
            ┛            ┛     ┛
                     │
              ┌──────┴──────┐
              │  <      />  │
              │             │
              │     ___     │
              └──────┴──────┘
`}
      </Text>
      <Text dimColor>From ITMan.fyi with ❤️</Text>
      <Box marginTop={1}>
        <Text>Type a message, / for commands, @ for skills</Text>
      </Box>
      <Text>/model - Switch model /clear - Clear /exit - Exit</Text>
      <Text>@skill-name - Load a skill</Text>
    </Box>
  );
}

export function ChatLayout({
  messages,
  currentModel,
  inputValue,
  onInputChange,
  onInputSubmit,
  onCommandSelect,
  onModelSelect,
  onSkillSelect,
  inputPlaceholder,
  inputDisabled,
  showModelPicker = false,
  enabledProviders,
  skillItems = [],
}: ChatLayoutProps): React.ReactElement {
  const statusContext = useStatusLine();
  const showCommandMenu = !inputDisabled && inputValue.startsWith("/");
  const commandFilter = showCommandMenu ? inputValue.slice(1) : "";
  const showSkillPicker = !inputDisabled && inputValue.startsWith("@") && skillItems.length > 0;
  const skillFilter = showSkillPicker ? inputValue.slice(1) : "";

  const availableModels: ModelPickerItem[] = enabledProviders
    ? getModelsForProviders(enabledProviders)
    : DEFAULT_MODELS;

  const handleCommandSelect = (command: Command) => {
    if (onCommandSelect) {
      onCommandSelect(command);
    }
    onInputChange("");
  };

  const handleModelSelect = (modelId: string) => {
    if (onModelSelect) {
      onModelSelect(modelId);
    }
  };

  const handleSkillSelect = (skill: SkillMetadata) => {
    if (onSkillSelect) {
      onSkillSelect(skill);
    }
    onInputChange("");
  };

  return (
    <Box flexDirection="column" height="100%">
      <Header model={currentModel} skillCount={skillItems.length} />

      <Box flexDirection="column" flexGrow={1}>
        {messages.length === 0 ? <WelcomeMessage /> : <MessageList messages={messages} />}
      </Box>

      <Box flexShrink={0} borderStyle="single" borderColor="gray" paddingX={1}>
        <StatusLine
          status={statusContext.status}
          model={statusContext.model}
          tokensUsed={statusContext.tokensUsed}
          tokensMax={statusContext.tokensMax}
          tool={statusContext.tool}
          mcpServerCount={statusContext.mcpServerCount}
        />
      </Box>

      <Box flexShrink={0}>
        {showCommandMenu && (
          <CommandMenu
            filter={commandFilter}
            onSelect={handleCommandSelect}
            onClose={() => onInputChange("")}
            skillItems={skillItems}
          />
        )}
        {showModelPicker && (
          <ModelPicker
            models={availableModels}
            currentModel={currentModel ?? ""}
            onSelect={handleModelSelect}
            onClose={() => onModelSelect?.("")}
          />
        )}
        {showSkillPicker && (
          <SkillPicker
            skills={skillItems}
            filter={skillFilter}
            onSelect={handleSkillSelect}
            onClose={() => onInputChange("")}
          />
        )}
        {!showCommandMenu && !showModelPicker && !showSkillPicker && (
          <TextInput
            value={inputValue}
            onChange={onInputChange}
            onSubmit={onInputSubmit}
            placeholder={inputPlaceholder}
            disabled={inputDisabled}
          />
        )}
      </Box>
    </Box>
  );
}
