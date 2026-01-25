import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, render, useInput } from "ink";
import { ChatProvider, useChatContext } from "./contexts/ChatContext.js";
import { StatusLineProvider } from "./contexts/StatusLineContext.js";
import { ToastProvider, useToastContext } from "./contexts/ToastContext.js";
import { ChatLayout } from "./components/ChatLayout.js";
import type { EnabledProviders } from "./components/ModelPicker.js";
import type { SkillMetadata } from "../skills/types.js";
import type { Agent } from "@/core/agent.js";
import { useCommandHandler } from "./hooks/useCommandHandler.js";
import { MessageRole } from "./types/enums.js";
import { formatTimestamp } from "./utils.js";

export function ChatApp(): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const {
    messages,
    addMessage,
    isThinking,
    currentModel,
    setCurrentModel,
    streamingText,
    sendMessage,
    clearMessages,
    cancelActiveRequest,
    enabledProviders,
    agent,
  } = useChatContext();
  const { addToast } = useToastContext();

  const { handleCommandSelect, handleSlashCommand } = useCommandHandler({
    onAddMessage: addMessage,
    onClearMessages: clearMessages,
    onSetShowModelPicker: setShowModelPicker,
    onExit: () => process.exit(0),
    agent: agent ?? undefined,
  });

  // Initialize agent when it becomes available (background, non-blocking)
  const [skillItems, setSkillItems] = useState<SkillMetadata[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const skillInvokedThisMessageRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!agent || isInitialized) return;
    const initAgent = async () => {
      try {
        // Show "connecting" toasts first
        addToast("Connecting to MCP servers...", "info");

        await agent.waitForSkills();
        const skills = Array.from(agent.getSkillRegistry().values());
        setSkillItems(skills);
        setIsInitialized(true);

        // Show completion toasts for each category
        const toolCount = agent.getToolCount();
        if (toolCount > 0) {
          addToast(`${toolCount} tools loaded`, "success");
        }

        const mcpServers = await agent.getMcpServerStatus();
        const mcpConnected = mcpServers.filter((s) => s.connected);
        if (mcpConnected.length > 0) {
          addToast(`${mcpConnected.length} MCP server${mcpConnected.length > 1 ? "s" : ""} connected`, "success");
        } else {
          addToast("No MCP servers configured", "info");
        }

        if (skills.length > 0) {
          addToast(`${skills.length} skills loaded`, "success");
        }
      } catch {
        // Silently fail - skills will be empty, user can retry or continue without skills
      }
    };
    initAgent();
  }, [agent, isInitialized, addToast]);

  // Handle escape key for cancellation
  useInput(
    () => {
      if (isThinking) {
        cancelActiveRequest();
        addMessage(MessageRole.ASSISTANT, "\nCancelled. Type a new message or /exit to quit.");
      }
    },
    { isActive: isThinking },
  );

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  const handleInputSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isThinking) return;

      skillInvokedThisMessageRef.current.clear();

      if (trimmed.startsWith("/")) {
        setInputValue("");
        handleSlashCommand(trimmed);
        return;
      }

      setInputValue("");
      await sendMessage(trimmed);
    },
    [isThinking, sendMessage, handleSlashCommand],
  );

  const handleModelSelect = useCallback(
    (modelId: string) => {
      if (modelId && modelId !== currentModel) {
        setCurrentModel(modelId);
        addMessage(MessageRole.SEPARATOR, formatTimestamp());
        const displayName = modelId.replace(/^opencode\//, "");
        addMessage(MessageRole.ASSISTANT, `Model changed to: ${displayName}`);
      }
      setShowModelPicker(false);
    },
    [addMessage, currentModel, setCurrentModel],
  );

  const handleSkillSelect = useCallback(
    async (skill: SkillMetadata) => {
      if (!agent) {
        addMessage(MessageRole.ASSISTANT, "Error: Agent not initialized.");
        return;
      }

      if (skillInvokedThisMessageRef.current.has(skill.name)) {
        return;
      }
      skillInvokedThisMessageRef.current.add(skill.name);

      try {
        const result = await agent.loadSkill(skill.name);
        if (!result) {
          addMessage(MessageRole.ASSISTANT, `Error: Skill not found: ${skill.name}`);
          return;
        }

        const { allowedTools } = result;
        if (allowedTools) {
          addMessage(
            MessageRole.ASSISTANT,
            `Loaded skill: **@${skill.name}**\nRestricted tools to: ${allowedTools.join(", ")}`,
          );
        } else {
          addMessage(
            MessageRole.ASSISTANT,
            `Loaded skill: **@${skill.name}**\nAll tools available.`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addMessage(MessageRole.ASSISTANT, `Error loading skill: ${message}`);
      }
    },
    [agent, addMessage],
  );

  const displayMessages = isThinking
    ? [
        ...messages,
        {
          id: "streaming",
          role: MessageRole.ASSISTANT,
          content: streamingText || "...",
        },
      ]
    : messages;

  return (
    <Box flexDirection="column" height="100%">
      <ChatLayout
        messages={displayMessages}
        currentModel={currentModel}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onInputSubmit={handleInputSubmit}
        onCommandSelect={handleCommandSelect}
        onModelSelect={handleModelSelect}
        onSkillSelect={handleSkillSelect}
        inputDisabled={isThinking}
        showModelPicker={showModelPicker}
        inputPlaceholder={
          isThinking
            ? "Waiting for response... (ESC twice to cancel)"
            : "Type a message... (/ for commands)"
        }
        enabledProviders={enabledProviders}
        skillItems={skillItems}
      />
    </Box>
  );
}

interface AppProps {
  children?: React.ReactNode;
  initialModel?: string;
  agent?: Agent;
  enabledProviders?: EnabledProviders;
}

export function App({
  children,
  initialModel,
  agent,
  enabledProviders,
}: AppProps): React.ReactElement {
  return (
    <StatusLineProvider>
      <ToastProvider>
        <ChatProvider initialModel={initialModel} agent={agent} enabledProviders={enabledProviders}>
          {children ?? <ChatApp />}
        </ChatProvider>
      </ToastProvider>
    </StatusLineProvider>
  );
}

export function renderApp(element: React.ReactElement) {
  return render(element);
}
