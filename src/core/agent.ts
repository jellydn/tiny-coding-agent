import { loadAgentsMd } from "../config/loader.js";
import type { ObservabilityConfig, ThinkingConfig } from "../config/schema.js";
import type { McpManager } from "../mcp/manager.js";
import { parseModelString } from "../providers/factory.js";
import { detectProvider } from "../providers/model-registry.js";
import type { LLMClient, Message, TokenUsage } from "../providers/types.js";
import { getBuiltinSkillsDir, type SkillMetadata } from "../skills/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import { AgentObservability } from "./agent-observability.js";
import {
	type StreamFinalAnswerResult,
	type StreamLlmResult,
	streamFinalAnswer,
	streamLlmResponse,
} from "./agent-utils.js";
import { buildContextStats, type PrepareContextResult, prepareContext } from "./context-budget.js";
import { ConversationManager } from "./conversation.js";
import { DebugLogger } from "./debug-logger.js";
import type { ContextStats } from "./memory.js";
import { MemoryStore } from "./memory.js";
import { ProviderCache, type ProviderConfigs } from "./provider-cache.js";
import { SkillManager } from "./skill-manager.js";
import { TurnExecutor } from "./turn-executor.js";

// Re-export for backward compatibility — other modules and tests import
// isLooping, truncateOutput, and streamLlmResponse from agent.ts. The
// canonical home is agent-utils.ts (extracted to break the agent.ts ↔
// turn-executor.ts cycle and to eliminate the duplicate stream pattern).
export { isLooping, streamLlmResponse, truncateOutput } from "./agent-utils.js";

export function checkAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException("Aborted", "AbortError");
	}
}

export function redactApiKey(key?: string): string {
	if (!key) return "(not set)";
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}...REDACTED`;
}

// Re-export ProviderConfigs for backward compatibility — tests and other
// modules import it from agent.ts. The canonical home is now provider-cache.ts.
export type { ProviderConfigs } from "./provider-cache.js";

export interface AgentOptions {
	maxIterations?: number;
	systemPrompt?: string;
	verbose?: boolean;
	conversationFile?: string;
	maxContextTokens?: number;
	memoryFile?: string;
	maxMemoryTokens?: number;
	memoryBudgetPercent?: number;
	trackContextUsage?: boolean;
	agentsMdPath?: string;
	thinking?: ThinkingConfig;
	providerConfigs?: ProviderConfigs;
	providerCacheSize?: number;
	skillDirectories?: string[];
	mcpManager?: McpManager | null;
	observability?: ObservabilityConfig;
}

export interface RuntimeConfig {
	model?: string;
	thinking?: ThinkingConfig;
}

export interface ToolExecution {
	name: string;
	status: "running" | "complete" | "error";
	args?: Record<string, unknown>;
	output?: string;
	error?: string;
	summary?: string;
	duration?: number;
	startTime?: number;
}

export interface AgentObservabilityMeta {
	traceId: string;
	latencyMs: number;
	usage?: TokenUsage;
	estimatedCostUsd: number;
}

export interface AgentStreamChunk {
	content: string;
	iterations: number;
	done: boolean;
	toolCalls?: string[];
	toolExecutions?: ToolExecution[];
	contextStats?: ContextStats;
	maxIterationsReached?: boolean;
	/** Observability metadata, present on the final (`done`) chunk. */
	observability?: AgentObservabilityMeta;
}

export interface AgentResponse {
	content: string;
	iterations: number;
	messages: Message[];
}

export interface HealthStatus {
	ready: boolean;
	issues: string[];
	providerCount: number;
	skillCount: number;
	memoryEnabled: boolean;
	mcpServers?: Array<{ name: string; connected: boolean; toolCount: number }>;
}

export interface ShutdownOptions {
	signal?: boolean;
}

export function isValidToolCall(text: string): boolean {
	try {
		const parsed = JSON.parse(text);
		return typeof parsed?.name === "string";
	} catch {
		return false;
	}
}

export class Agent {
	private _providerCache: ProviderCache;
	private _providerConfigs?: ProviderConfigs;
	private _toolRegistry: ToolRegistry;
	private _maxIterations: number;
	private _systemPrompt: string;
	private _verbose: boolean;
	private _maxContextTokens?: number;
	private _memoryStore?: MemoryStore;
	private _maxMemoryTokens?: number;
	private _memoryBudgetPercent?: number;
	private _trackContextUsage: boolean;
	private _thinking?: ThinkingConfig;
	private _conversationManager!: ConversationManager;
	private _skillManager: SkillManager;
	private _mcpManager?: McpManager;
	private _obsWrapper: AgentObservability;
	private _turnExecutor: TurnExecutor;
	private _debug: DebugLogger;

	constructor(llmClient: LLMClient, toolRegistry: ToolRegistry, options: AgentOptions = {}) {
		this._providerConfigs = options.providerConfigs;
		this._providerCache = new ProviderCache(llmClient, options.providerConfigs, options.providerCacheSize);
		this._toolRegistry = toolRegistry;
		this._maxIterations = options.maxIterations ?? 20;
		this._verbose = options.verbose ?? false;
		this._maxContextTokens = options.maxContextTokens;
		this._maxMemoryTokens = options.maxMemoryTokens;
		this._memoryBudgetPercent = options.memoryBudgetPercent;
		this._trackContextUsage = options.trackContextUsage ?? false;
		this._thinking = options.thinking;
		this._mcpManager = options.mcpManager ?? undefined;
		this._conversationManager = new ConversationManager(options.conversationFile);
		this._obsWrapper = new AgentObservability(options.observability);
		this._turnExecutor = new TurnExecutor(toolRegistry, { verbose: options.verbose });
		this._debug = new DebugLogger(this._verbose);

		let effectiveSystemPrompt =
			options.systemPrompt ??
			"You are a helpful AI assistant with access to tools. Use available tools to help the user. When you have enough information to answer, provide your final response.";

		if (options.agentsMdPath) {
			const agentsMdContent = loadAgentsMd(options.agentsMdPath);
			if (agentsMdContent) {
				effectiveSystemPrompt = `${agentsMdContent}\n\n---\n\n${effectiveSystemPrompt}`;
			}
		}

		this._skillManager = new SkillManager(effectiveSystemPrompt);
		this._skillManager.initialize(options.skillDirectories ?? [], getBuiltinSkillsDir());
		this._systemPrompt = effectiveSystemPrompt;

		if (options.memoryFile) {
			this._memoryStore = new MemoryStore({ filePath: options.memoryFile });
		}
	}

	startChatSession(): void {
		this._conversationManager.startSession();
	}

	async _updateConversationHistory(messages: Message[]): Promise<void> {
		await this._conversationManager.setHistory(messages);
	}

	async *runStream(
		userPrompt: string,
		model: string,
		runtimeConfig?: RuntimeConfig,
		options?: { signal?: AbortSignal }
	): AsyncGenerator<AgentStreamChunk, void, unknown> {
		await this._skillManager.waitForSkills();
		this._systemPrompt = this._skillManager.systemPrompt;

		this._skillManager.clearRestriction();

		// --- Observability: begin request ----------------------------------
		const providerName = this._providerCache.getProviderName(runtimeConfig?.model ?? model);
		const obsCtx = { provider: providerName, model: runtimeConfig?.model ?? model };
		this._obsWrapper.beginRequest(userPrompt, obsCtx);
		// -------------------------------------------------------------------

		const effectiveModel = runtimeConfig?.model ?? model;
		const effectiveThinking = runtimeConfig?.thinking ?? this._thinking;
		const llmClient = this._providerCache.getClientForModel(effectiveModel);

		const { model: modelName } = parseModelString(effectiveModel);

		const conversationFile = this._conversationManager.conversationFile;
		let messages: Message[] = conversationFile
			? await this._conversationManager.loadHistory()
			: this._conversationManager.getHistory();

		const isContinuation = userPrompt === "continue";
		if (isContinuation || messages.length > 0) {
			messages.push({ role: "user", content: userPrompt });
		} else {
			messages = [{ role: "user", content: userPrompt }];
		}

		const ctxResult: PrepareContextResult = await prepareContext({
			systemPrompt: this._systemPrompt,
			userPrompt,
			messages,
			maxContextTokens: this._maxContextTokens,
			memoryStore: this._memoryStore,
			maxMemoryTokens: this._maxMemoryTokens,
			memoryBudgetPercent: this._memoryBudgetPercent,
			wrapRetrieval: () => {
				const { span: retrievalSpan, timer: retrievalTimer } = this._obsWrapper.beginRetrieval();
				return (resultCount: number, error?: unknown) => {
					if (error !== undefined) {
						this._obsWrapper.recordRetrievalError(retrievalSpan, error);
					}
					this._obsWrapper.recordRetrieval(retrievalSpan, retrievalTimer, resultCount);
				};
			},
		});
		messages = ctxResult.messages;
		let contextStats: ContextStats = ctxResult.stats;
		const memoryTokensUsed = ctxResult.memoryTokensUsed;
		const truncationApplied = ctxResult.truncationApplied;
		const systemTokens = ctxResult.systemTokens;
		const maxContextTokens = ctxResult.stats.maxContextTokens;

		const tools = this._skillManager.filterTools(
			this._toolRegistry.list().map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}))
		);

		const providerTypeForDetails = detectProvider(effectiveModel);
		this._debug.logRequestDetails({
			providerType: providerTypeForDetails,
			model: effectiveModel,
			providerConfig: this._providerConfigs?.[providerTypeForDetails],
			thinking: effectiveThinking,
			systemPromptLength: this._systemPrompt.length,
			messageCount: messages.length,
			toolCount: tools.length,
			maxContextTokens: this._maxContextTokens,
			memoryCount: this._memoryStore?.count(),
		});

		let iteration = 0;
		let loopDetected = false;

		this._turnExecutor.reset();

		const updateStats = (): ContextStats =>
			buildContextStats({
				systemTokens,
				memoryTokens: memoryTokensUsed,
				messages,
				truncationApplied,
				maxContextTokens,
			});

		try {
			for (iteration = 0; iteration < this._maxIterations; iteration++) {
				checkAborted(options?.signal);

				this._debug.logIteration(iteration, contextStats, this._trackContextUsage);

				// --- Observability: LLM request span + timer ------------------------
				const { span: llmSpan, timer: llmTimer } = this._obsWrapper.beginLlmCall({
					provider: providerName,
					model: modelName,
				});
				let llmUsage: TokenUsage | undefined;
				let llmTimeToFirstToken: number | undefined;
				// --------------------------------------------------------------------

				let fullContent = "";
				let responseToolCalls: string[] = [];
				const assistantToolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

				try {
					const streamGen = streamLlmResponse({
						llmClient,
						model: modelName,
						systemPrompt: this._systemPrompt,
						messages,
						tools: tools.length > 0 ? tools : undefined,
						thinking: effectiveThinking,
						signal: options?.signal,
					});

					// while(true) + gen.next() is required (not for-await) because we
					// need the generator's return value (StreamLlmResult) which
					// for-await does not expose.
					while (true) {
						const { value, done } = await streamGen.next();
						if (done) {
							const result = value as StreamLlmResult;
							assistantToolCalls.push(...result.toolCalls);
							responseToolCalls = result.toolCalls.map((tc) => tc.name);
							llmUsage = result.usage;
							llmTimeToFirstToken = result.timeToFirstTokenMs;
							break;
						}
						// value is a content string — filter tool-call JSON from display
						if (!isValidToolCall(value)) {
							fullContent += value;
							yield {
								content: value,
								iterations: iteration + 1,
								done: false,
								contextStats,
							};
						}
					}
				} catch (err) {
					this._obsWrapper.recordLlmCallError(llmSpan, err);
					const streamError = err as Error | DOMException;
					if (streamError instanceof DOMException && streamError.name === "AbortError") {
						throw streamError;
					}
					const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
					this._obsWrapper.markFailed();
					yield {
						content: `\n\nError during LLM stream: ${errorMessage}`,
						iterations: iteration + 1,
						done: true,
						contextStats,
						observability: this._obsWrapper.buildMeta(modelName),
					};
					return;
				}

				const llmLatencyMs = Math.round(llmTimer.ms);

				// --- Observability: record LLM call --------------------------------
				this._obsWrapper.recordLlmResponse(
					llmSpan,
					llmTimer,
					{ provider: providerName, model: modelName },
					{
						usage: llmUsage,
						content: fullContent,
						latencyMs: llmLatencyMs,
						timeToFirstTokenMs: llmTimeToFirstToken,
					},
					userPrompt
				);
				// --------------------------------------------------------------------

				this._debug.logLlmResponse(fullContent, responseToolCalls);

				const assistantMessage: Message = {
					role: "assistant",
					content: fullContent,
				};

				messages.push(assistantMessage);

				if (assistantToolCalls.length > 0) {
					assistantMessage.toolCalls = assistantToolCalls;
				}

				if (assistantToolCalls.length === 0) {
					this._debug.logAgentFinished(iteration + 1);

					await this._updateConversationHistory(messages);

					yield {
						content: "",
						iterations: iteration + 1,
						done: true,
						contextStats,
						observability: this._obsWrapper.buildMeta(modelName),
					};
					return;
				}

				checkAborted(options?.signal);

				// --- Tool execution via TurnExecutor --------------------------------
				const { span: toolSpan, timer: toolTimer } = this._obsWrapper.beginToolExecution();

				// Yield "running" display objects
				yield {
					content: "",
					iterations: iteration + 1,
					done: false,
					toolExecutions: TurnExecutor.runningDisplay(assistantToolCalls),
					contextStats,
				};

				const turnResult = await this._turnExecutor.executeTurn(assistantToolCalls);
				const toolDuration = Math.round(toolTimer.ms);

				// --- Observability: record tool execution ---------------------------
				this._obsWrapper.recordToolResult(
					toolSpan,
					toolTimer,
					assistantToolCalls.map((tc) => tc.name),
					turnResult.toolExecutions.map((exec) => ({
						name: exec.name,
						status: (exec.status === "complete" ? "complete" : "error") as "complete" | "error",
						latencyMs: toolDuration,
						error: exec.error,
					}))
				);
				// --------------------------------------------------------------------

				// Yield "complete/error" display objects
				yield {
					content: "",
					iterations: iteration + 1,
					done: false,
					toolExecutions: turnResult.toolExecutions.map((te) => ({ ...te, duration: toolDuration })),
					contextStats,
				};

				checkAborted(options?.signal);

				// Append tool result messages to the conversation
				for (const msg of turnResult.toolResultMessages) {
					messages.push(msg);
				}

				// Append system messages (error recovery instructions)
				for (const msg of turnResult.systemMessages) {
					messages.push(msg);
				}

				// Handle loop break reasons
				if (turnResult.loopBreakReason) {
					loopDetected = true;
					break;
				}

				contextStats = updateStats();
			}

			if (loopDetected) {
				this._debug.logLoopDetected();

				// Use streamFinalAnswer to eliminate the duplicate stream-creation +
				// iteration + catch pattern. The helper yields content strings and
				// returns a StreamFinalAnswerResult with the full content or error.
				const finalGen = streamFinalAnswer({
					llmClient,
					model: modelName,
					systemPrompt: this._systemPrompt,
					messages,
					thinking: effectiveThinking,
					signal: options?.signal,
				});

				let finalResult: StreamFinalAnswerResult;
				while (true) {
					const { value, done } = await finalGen.next();
					if (done) {
						finalResult = value;
						break;
					}
					yield {
						content: value,
						iterations: iteration + 1,
						done: false,
						contextStats: updateStats(),
					};
				}

				if (finalResult.aborted) {
					throw new DOMException("Aborted", "AbortError");
				}

				if (finalResult.error) {
					this._obsWrapper.markFailed();
					yield {
						content: `\n\nError during LLM stream: ${finalResult.error}`,
						iterations: iteration + 1,
						done: true,
						contextStats: updateStats(),
						observability: this._obsWrapper.buildMeta(modelName),
					};
					return;
				}

				await this._updateConversationHistory(messages);
				yield {
					content: "",
					iterations: iteration + 1,
					done: true,
					contextStats: updateStats(),
					observability: this._obsWrapper.buildMeta(modelName),
				};
				return;
			}

			this._debug.logMaxIterations(this._maxIterations);

			await this._updateConversationHistory(messages);

			yield {
				content: "",
				iterations: iteration,
				done: true,
				maxIterationsReached: true,
				contextStats: updateStats(),
				observability: this._obsWrapper.buildMeta(modelName),
			};
		} catch (err) {
			// --- Observability: record failure against the trace --------------
			this._obsWrapper.recordRequestError({ provider: providerName, model: modelName }, err);
			// ----------------------------------------------------------------
			throw err;
		} finally {
			// --- Observability: close root span + emit request.end -----------
			this._obsWrapper.finalize({ provider: providerName, model: modelName });
			// ----------------------------------------------------------------
		}
	}

	async run(userPrompt: string, model: string): Promise<AgentResponse> {
		let fullContent = "";
		let iterations = 0;

		for await (const chunk of this.runStream(userPrompt, model)) {
			if (!chunk.done) {
				fullContent += chunk.content;
			}
			iterations = chunk.iterations;
		}

		return {
			content: fullContent,
			iterations,
			messages: this._conversationManager.getHistory(),
		};
	}

	getSkillRegistry(): Map<string, SkillMetadata> {
		return this._skillManager.getRegistry();
	}

	getMemoryStore(): MemoryStore | undefined {
		return this._memoryStore;
	}

	getToolCount(): number {
		return this._toolRegistry.list().length;
	}

	/** Returns the provider configs the agent was constructed with.
	 *  Used by the `/login` chat command to display connection status. */
	getProviderConfigs(): ProviderConfigs | undefined {
		return this._providerConfigs;
	}

	async getMcpServerStatus(): Promise<Array<{ name: string; connected: boolean; toolCount: number }>> {
		if (this._mcpManager) {
			return this._mcpManager.getServerStatus();
		}
		return [];
	}

	async waitForSkills(): Promise<void> {
		await this._skillManager.waitForSkills();
	}

	async loadSkill(
		skillName: string
	): Promise<{ content: string; wrappedContent: string; allowedTools?: string[] } | null> {
		return this._skillManager.loadSkill(skillName);
	}

	_setSkillRestriction(allowedTools: string[] | undefined): void {
		this._skillManager.setRestriction(allowedTools);
	}

	_clearSkillRestriction(): void {
		this._skillManager.clearRestriction();
	}

	async healthCheck(): Promise<HealthStatus> {
		const issues: string[] = [];

		// The default LLM client is always provided in the constructor, so
		// we only flag an issue when provider configs are explicitly empty.
		if (this._providerConfigs && Object.keys(this._providerConfigs).length === 0) {
			issues.push("Provider configs empty");
		}

		if (issues.length > 0) {
			return {
				ready: false,
				issues,
				providerCount: this._providerCache.size,
				skillCount: this._skillManager.count,
				memoryEnabled: !!this._memoryStore,
				mcpServers: this._mcpManager?.getServerStatus() ?? [],
			};
		}

		return {
			ready: true,
			issues,
			providerCount: this._providerCache.size,
			skillCount: this._skillManager.count,
			memoryEnabled: !!this._memoryStore,
			mcpServers: this._mcpManager?.getServerStatus() ?? [],
		};
	}

	async shutdown(options?: ShutdownOptions): Promise<void> {
		if (this._memoryStore) {
			this._memoryStore.flush();
		}

		await this._conversationManager.close();

		if (options?.signal !== false) {
			// Remove signal handlers if any were registered
			process.removeAllListeners("SIGTERM");
			process.removeAllListeners("SIGINT");
		}
	}
}
