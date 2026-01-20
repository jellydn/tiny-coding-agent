import React, { createContext, useContext, useState, type ReactNode } from "react";
import type { ToolExecution } from "../../core/agent.js";

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  role: MessageRole;
  content: string;
  toolExecutions?: ToolExecution[];
}

interface ChatContextValue {
  messages: ChatMessage[];
  addMessage: (role: MessageRole, content: string) => void;
  clearMessages: () => void;
  isThinking: boolean;
  setThinking: (thinking: boolean) => void;
  streamingText: string;
  setStreamingText: (text: string) => void;
  currentModel: string;
  setCurrentModel: (model: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}

interface ChatProviderProps {
  children: ReactNode;
  initialModel?: string;
}

export function ChatProvider({
  children,
  initialModel = "",
}: ChatProviderProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setThinkingState] = useState(false);
  const [streamingText, setStreamingTextState] = useState("");
  const [currentModel, setCurrentModelState] = useState(initialModel);

  const addMessage = (role: MessageRole, content: string) => {
    setMessages((prev) => [...prev, { role, content }]);
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const setThinking = (thinking: boolean) => {
    setThinkingState(thinking);
  };

  const setStreamingText = (text: string) => {
    setStreamingTextState(text);
  };

  const setCurrentModel = (model: string) => {
    setCurrentModelState(model);
  };

  return (
    <ChatContext.Provider
      value={{
        messages,
        addMessage,
        clearMessages,
        isThinking,
        setThinking,
        streamingText,
        setStreamingText,
        currentModel,
        setCurrentModel,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
