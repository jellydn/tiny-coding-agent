import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Agent, ToolExecution } from "../../core/agent.js";
import { statusLineManager } from "../status-line-manager.js";
import { StatusType } from "../types/enums.js";
import { MessageRole, ToolStatus } from "../types/enums.js";
import { AgentNotInitializedError, MessageEmptyError, StreamError } from "../errors/chat-errors.js";
import type { EnabledProviders } from "../components/ModelPicker.js";
import { formatTimestamp } from "../utils.js";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  toolStatus?: ToolStatus;
  toolArgs?: Record<string, unknown>;
}

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface ChatContextValue {
  messages: ChatMessage[];
  addMessage: (
    role: MessageRole,
    content: string,
    options?: {
      toolName?: string;
      toolStatus?: ToolStatus;
      toolArgs?: Record<string, unknown>;
    },
  ) => void;
  clearMessages: () => void;
  isThinking: boolean;
  setThinking: (thinking: boolean) => void;
  streamingText: string;
  setStreamingText: (text: string | ((prev: string) => string)) => void;
  currentModel: string;
  setCurrentModel: (model: string) => void;
  sendMessage: (content: string) => Promise<void>;
  currentToolExecutions: ToolExecution[];
  cancelActiveRequest: () => void;
  enabledProviders?: EnabledProviders;
  agent?: Agent;
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
  agent?: Agent;
  enabledProviders?: EnabledProviders;
}

export function ChatProvider({
  children,
  initialModel = "",
  agent,
  enabledProviders,
}: ChatProviderProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setThinkingState] = useState(false);
  const [streamingText, setStreamingTextState] = useState("");
  const [currentModel, setCurrentModelState] = useState(initialModel);
  const [currentToolExecutions, setCurrentToolExecutions] = useState<ToolExecution[]>([]);
  const seenToolsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelActiveRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const addMessage = useCallback(
    (
      role: MessageRole,
      content: string,
      options?: {
        toolName?: string;
        toolStatus?: ToolStatus;
        toolArgs?: Record<string, unknown>;
      },
    ) => {
      setMessages((prev) => [...prev, { id: generateMessageId(), role, content, ...options }]);
    },
    [],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    if (agent) {
      agent.startChatSession();
    }
  }, [agent]);

  const setThinking = useCallback((thinking: boolean) => {
    setThinkingState(thinking);
  }, []);

  const setStreamingText = useCallback((text: string | ((prev: string) => string)) => {
    setStreamingTextState(text);
  }, []);

  const setCurrentModel = useCallback((model: string) => {
    setCurrentModelState(model);
  }, []);

  const formatToolCall = useCallback((te: ToolExecution): string => {
    const MAX_ARG_LENGTH = 40;
    const argsStr = te.args
      ? Object.entries(te.args)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => {
            const str = typeof v === "string" ? v : JSON.stringify(v);
            return `${k}=${str.length > MAX_ARG_LENGTH ? str.slice(0, MAX_ARG_LENGTH) + "..." : str}`;
          })
          .join(" ")
      : "";
    return `🔧 ${te.name}${argsStr ? ` ${argsStr}` : ""}`;
  }, []);

  const formatToolOutput = useCallback((te: ToolExecution): string => {
    const output = te.error || te.output || "";
    if (!output) return "";
    const MAX_OUTPUT_LINES = 10;
    const allLines = output.split("\n");
    const lines = allLines.slice(0, MAX_OUTPUT_LINES);
    const prefix = te.error ? "✗" : "✓";
    return `\n${prefix} ${lines.join("\n  ")}${lines.length < allLines.length ? "\n  ..." : ""}`;
  }, []);

  const handleChatError = useCallback(
    (err: unknown): void => {
      const isKnownError =
        err instanceof AgentNotInitializedError ||
        err instanceof MessageEmptyError ||
        err instanceof StreamError;
      const errorMsg = isKnownError
        ? (err as Error).message
        : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;

      addMessage(MessageRole.ASSISTANT, `Error: ${errorMsg}`);
      statusLineManager.setStatus(StatusType.ERROR);
    },
    [addMessage],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        if (!agent) {
          throw new AgentNotInitializedError();
        }

        if (!content.trim()) {
          throw new MessageEmptyError();
        }

        addMessage(MessageRole.SEPARATOR, formatTimestamp());
        addMessage(MessageRole.USER, content);
        setThinking(true);
        setStreamingText("");
        setCurrentToolExecutions([]);
        seenToolsRef.current.clear();
        statusLineManager.setStatus(StatusType.THINKING);
        statusLineManager.setModel(currentModel.replace(/^opencode\//, ""));

        let accumulatedContent = "";

        let wasAborted = false;

        try {
          for await (const chunk of agent.runStream(content, currentModel, undefined, {
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) {
              wasAborted = true;
              break;
            }

            if (chunk.content) {
              accumulatedContent += chunk.content;
              setStreamingText(accumulatedContent);
            }

            if (chunk.toolExecutions) {
              setCurrentToolExecutions([...chunk.toolExecutions]);

              for (const te of chunk.toolExecutions) {
                const toolKey = `${te.name}-${te.status}`;

                if (te.status === ToolStatus.RUNNING) {
                  if (!seenToolsRef.current.has(toolKey)) {
                    seenToolsRef.current.add(toolKey);
                    accumulatedContent += `\n${formatToolCall(te)}`;
                    setStreamingText(accumulatedContent);
                  }
                } else if (te.status === ToolStatus.COMPLETE || te.status === ToolStatus.ERROR) {
                  if (!seenToolsRef.current.has(toolKey)) {
                    seenToolsRef.current.add(toolKey);
                    accumulatedContent += formatToolOutput(te);
                    setStreamingText(accumulatedContent);
                  }
                }
              }

              const runningTool = chunk.toolExecutions.find(
                (te) => te.status === ToolStatus.RUNNING,
              );
              if (runningTool) {
                statusLineManager.setTool(runningTool.name);
              } else {
                statusLineManager.clearTool();
              }
            }

            if (chunk.contextStats) {
              statusLineManager.setContext(
                chunk.contextStats.totalTokens,
                chunk.contextStats.maxContextTokens,
              );
            }

            if (chunk.done) {
              break;
            }
          }
        } catch (streamErr) {
          if (streamErr instanceof DOMException && streamErr.name === "AbortError") {
            wasAborted = true;
          } else {
            throw new StreamError(streamErr);
          }
        }

        if (accumulatedContent) {
          const finalContent = wasAborted
            ? accumulatedContent + "\n\n*(cancelled)*"
            : accumulatedContent;
          addMessage(MessageRole.ASSISTANT, finalContent);
        }
        statusLineManager.setStatus(wasAborted ? StatusType.READY : StatusType.READY);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        handleChatError(err);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setThinking(false);
        setStreamingText("");
        setCurrentToolExecutions([]);
      }
    },
    [
      agent,
      currentModel,
      addMessage,
      setThinking,
      setStreamingText,
      formatToolCall,
      formatToolOutput,
      handleChatError,
      cancelActiveRequest,
    ],
  );

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
        sendMessage,
        currentToolExecutions,
        cancelActiveRequest,
        enabledProviders,
        agent,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
