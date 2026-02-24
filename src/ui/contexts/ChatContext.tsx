import React, { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Agent, ToolExecution } from "../../core/agent.js";
import type { EnabledProviders } from "../components/ModelPicker.js";
import { AgentNotInitializedError, MessageEmptyError, StreamError } from "../errors/chat-errors.js";
import { statusLineManager } from "../status-line-manager.js";
import { MessageRole, StatusType, type ToolStatus } from "../types/enums.js";
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
		}
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
	initialPrompt?: string;
	agent?: Agent;
	enabledProviders?: EnabledProviders;
}

export function ChatProvider({
	children,
	initialModel = "",
	initialPrompt,
	agent,
	enabledProviders,
}: ChatProviderProps): React.ReactElement {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isThinking, setThinkingState] = useState(false);
	const [streamingText, setStreamingTextState] = useState("");
	const [currentModel, setCurrentModelState] = useState(initialModel);
	const [currentToolExecutions, setCurrentToolExecutions] = useState<ToolExecution[]>([]);
	const abortControllerRef = useRef<AbortController | null>(null);
	const initialPromptSentRef = useRef(false);

	// Initialize status line with model on mount
	useEffect(() => {
		if (initialModel) {
			statusLineManager.setModel(initialModel.replace(/^opencode\//, ""));
		}
	}, [initialModel]);

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
			}
		) => {
			setMessages((prev) => [...prev, { id: generateMessageId(), role, content, ...options }]);
		},
		[]
	);

	const clearMessages = useCallback(() => {
		setMessages([]);
		setCurrentToolExecutions([]);
		setStreamingTextState("");
		if (agent) {
			agent.startChatSession();
		}
	}, [agent]);

	const setThinking = setThinkingState;

	const setStreamingText = setStreamingTextState;

	const setCurrentModel = setCurrentModelState;

	const handleChatError = useCallback(
		(err: unknown): void => {
			const isKnownError =
				err instanceof AgentNotInitializedError || err instanceof MessageEmptyError || err instanceof StreamError;
			const errorMsg = isKnownError
				? (err as Error).message
				: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;

			addMessage(MessageRole.ASSISTANT, `Error: ${errorMsg}`);
			statusLineManager.setStatus(StatusType.ERROR);
		},
		[addMessage]
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
				statusLineManager.setStatus(StatusType.THINKING);
				statusLineManager.setModel(currentModel.replace(/^opencode\//, ""));

				let accumulatedContent = "";
				const accumulatedTools: ToolExecution[] = [];
				const seenToolIds = new Set<string>();

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
							for (const te of chunk.toolExecutions) {
								const toolId = `${te.name}-${JSON.stringify(te.args)}`;
								const existingIdx = accumulatedTools.findIndex((t) => `${t.name}-${JSON.stringify(t.args)}` === toolId);

								if (existingIdx >= 0) {
									accumulatedTools[existingIdx] = te;
								} else if (!seenToolIds.has(toolId)) {
									seenToolIds.add(toolId);
									accumulatedTools.push(te);
								}
							}
							setCurrentToolExecutions([...accumulatedTools]);
						}

						if (accumulatedContent.trim() || accumulatedTools.length > 0) {
							let streamingText = accumulatedContent.trim();
							for (const te of accumulatedTools) {
								const argsStr = Object.entries(te.args ?? {})
									.filter(([, v]) => v !== undefined)
									.map(([, v]) => (typeof v === "string" ? v : JSON.stringify(v)))
									.join(" ");

								if (te.status === "running") {
									streamingText += `\n[running] ${te.name}${argsStr ? ` ${argsStr}` : ""}...`;
								} else {
									const icon = te.status === "complete" ? "[✓]" : "[✗]";
									const duration = te.duration ? ` (${te.duration}ms)` : "";
									streamingText += `\n${icon} ${te.name}${argsStr ? ` ${argsStr}` : ""}${duration}`;
								}
							}
							if (accumulatedTools.length > 0) streamingText += "\n";
							setStreamingText(streamingText);
						} else {
							setStreamingText("Thinking...");
						}

						const runningTool = accumulatedTools.find((te) => te.status === "running");
						if (runningTool) {
							statusLineManager.setTool(runningTool.name);
						} else {
							statusLineManager.setTool(undefined);
						}

						if (chunk.contextStats) {
							const maxTokens = chunk.contextStats.maxContextTokens ?? 32000;
							statusLineManager.setContext(chunk.contextStats.totalTokens, maxTokens);
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

				let finalContent = accumulatedContent;
				const toolMarkerMatch = accumulatedContent.match(/\n(\[✓\]|\[✗\]|\[running\])/);
				if (toolMarkerMatch) {
					finalContent = accumulatedContent.slice(0, toolMarkerMatch.index);
				}
				finalContent = finalContent.trim();

				if (!finalContent && accumulatedTools.length > 0) {
					finalContent = "(Tool execution completed)";
				}

				if (finalContent) {
					if (wasAborted) addMessage(MessageRole.ASSISTANT, `${finalContent}\n\n*(cancelled)*`);
					else addMessage(MessageRole.ASSISTANT, finalContent);
				}
				statusLineManager.setStatus(wasAborted ? StatusType.READY : StatusType.READY);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") {
					return;
				}
				handleChatError(err);
			} finally {
				statusLineManager.clearTool();
				if (abortControllerRef.current === controller) {
					abortControllerRef.current = null;
				}
				setThinking(false);
				setStreamingText("");
				statusLineManager.setStatus(StatusType.READY);
			}
		},
		[agent, currentModel, addMessage, handleChatError]
	);

	useEffect(() => {
		if (initialPrompt && agent && !initialPromptSentRef.current) {
			initialPromptSentRef.current = true;
			sendMessage(initialPrompt);
		}
	}, [initialPrompt, agent, sendMessage]);

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
