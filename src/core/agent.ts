import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadAgentsMd } from "../config/loader.js";
import type { ObservabilityConfig, ProviderConfig, ThinkingConfig } from "../config/schema.js";
import type { McpManager } from "../mcp/manager.js";
import { createProvider, parseModelString } from "../providers/factory.js";
import { detectProvider } from "../providers/model-registry.js";
import type { LLMClient, Message, TokenUsage, ToolDefinition } from "../providers/types.js";
import { getEmbeddedSkillContent } from "../skills/builtin-registry.js";
import { discoverSkills, generateSkillsPrompt, getBuiltinSkillsDir, type SkillMetadata } from "../skills/index.js";
import { parseSkillFrontmatter } from "../skills/parser.js";
import type { ToolRegistry } from "../tools/registry.js";
import { escapeXml } from "../utils/xml.js";
import { AgentObservability } from "./agent-observability.js";
import {
	type StreamFinalAnswerResult,
	type StreamLlmResult,
	streamFinalAnswer,
	streamLlmResponse,
} from "./agent-utils.js";
import { buildContextStats, type PrepareContextResult, prepareContext } from "./context-budget.js";
import { ConversationManager } from "./conversation.js";
import type { ContextStats } from "./memory.js";
import { MemoryStore } from "./memory.js";
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

export interface ProviderConfigs {
	openai?: ProviderConfig;
	anthropic?: ProviderConfig;
	ollama?: ProviderConfig;
	ollamaCloud?: ProviderConfig;
	openrouter?: ProviderConfig;
	opencode?: ProviderConfig;
	zai?: ProviderConfig;
	clinepass?: ProviderConfig;
	qwencloud?: ProviderConfig;
}

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
	private _defaultLlmClient: LLMClient;
	private _providerConfigs?: ProviderConfigs;
	private _providerCache: Map<string, { client: LLMClient; timestamp: number; healthy: boolean }> = new Map();
	private static readonly DEFAULT_PROVIDER_CACHE_SIZE = 10;
	private _providerCacheMaxSize: number;
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
	private _skills: Map<string, SkillMetadata> = new Map();
	private _skillsInitialized: boolean = false;
	private _skillsInitPromise?: Promise<void>;
	private _activeSkillAllowedTools: string[] | undefined;
	private _mcpManager?: McpManager;
	private _obsWrapper: AgentObservability;
	private _turnExecutor: TurnExecutor;

	constructor(llmClient: LLMClient, toolRegistry: ToolRegistry, options: AgentOptions = {}) {
		this._defaultLlmClient = llmClient;
		this._providerConfigs = options.providerConfigs;
		this._providerCacheMaxSize = options.providerCacheSize ?? Agent.DEFAULT_PROVIDER_CACHE_SIZE;
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

		let effectiveSystemPrompt =
			options.systemPrompt ??
			"You are a helpful AI assistant with access to tools. Use available tools to help the user. When you have enough information to answer, provide your final response.";

		if (options.agentsMdPath) {
			const agentsMdContent = loadAgentsMd(options.agentsMdPath);
			if (agentsMdContent) {
				effectiveSystemPrompt = `${agentsMdContent}\n\n---\n\n${effectiveSystemPrompt}`;
			}
		}

		this._systemPrompt = effectiveSystemPrompt;

		this._skillsInitPromise = this._initializeSkills(
			options.skillDirectories ?? [],
			getBuiltinSkillsDir(),
			effectiveSystemPrompt
		);

		if (options.memoryFile) {
			this._memoryStore = new MemoryStore({ filePath: options.memoryFile });
		}
	}

	private async _initializeSkills(skillDirectories: string[], builtinDir: string, systemPrompt: string): Promise<void> {
		if (this._skillsInitPromise) {
			return this._skillsInitPromise;
		}

		this._skillsInitPromise = (async () => {
			if (this._skillsInitialized) return;

			const discoveredSkills = await discoverSkills(skillDirectories, builtinDir);
			for (const skill of discoveredSkills) {
				this._skills.set(skill.name, skill);
			}
			const skillsPrompt = generateSkillsPrompt(discoveredSkills);
			if (skillsPrompt) {
				this._systemPrompt = `${systemPrompt}\n\n${skillsPrompt}`;
			}
			this._skillsInitialized = true;
		})();

		return this._skillsInitPromise;
	}

	private _evictOldestCacheEntry(): void {
		let oldestKey: string | null = null;
		let oldestTimestamp = Infinity;
		for (const [key, entry] of this._providerCache.entries()) {
			if (entry.timestamp < oldestTimestamp) {
				oldestTimestamp = entry.timestamp;
				oldestKey = key;
			}
		}
		if (oldestKey) {
			this._providerCache.delete(oldestKey);
		}
	}

	private _getLlmClientForModel(model: string): LLMClient {
		if (!this._providerConfigs) return this._defaultLlmClient;

		const providerType = detectProvider(model);
		const cached = this._providerCache.get(providerType);

		if (cached?.healthy) {
			cached.timestamp = Date.now();
			return cached.client;
		}

		if (cached && !cached.healthy) {
			this._providerCache.delete(providerType);
		}

		try {
			const client = createProvider({
				model,
				provider: providerType,
				providers: this._providerConfigs,
			});

			if (this._providerCache.size >= this._providerCacheMaxSize) {
				this._evictOldestCacheEntry();
			}

			// Cache the new client as healthy
			this._providerCache.set(providerType, { client, timestamp: Date.now(), healthy: true });
			return client;
		} catch (err) {
			// Mark existing cache entry as unhealthy if it exists
			const existing = this._providerCache.get(providerType);
			if (existing) {
				existing.healthy = false;
			}
			console.warn(`[Agent] Failed to create provider for ${providerType}, falling back to default: ${err}`);
			return this._defaultLlmClient;
		}
	}

	/** Detect the provider name for a model string, for log/span attributes. */
	private _providerNameFor(model: string): string {
		try {
			return detectProvider(model);
		} catch {
			return "unknown";
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
		if (this._skillsInitPromise) {
			await this._skillsInitPromise;
		}

		this._clearSkillRestriction();

		// --- Observability: begin request ----------------------------------
		const providerName = this._providerNameFor(runtimeConfig?.model ?? model);
		const obsCtx = { provider: providerName, model: runtimeConfig?.model ?? model };
		this._obsWrapper.beginRequest(userPrompt, obsCtx);
		// -------------------------------------------------------------------

		const effectiveModel = runtimeConfig?.model ?? model;
		const effectiveThinking = runtimeConfig?.thinking ?? this._thinking;
		const llmClient = this._getLlmClientForModel(effectiveModel);

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

		const tools = this._getToolDefinitions();

		if (this._verbose) {
			const providerType = detectProvider(effectiveModel);
			const providerConfig = this._providerConfigs?.[providerType];

			console.log("\n[LLM Request Details]");
			console.log(`  Provider: ${providerType}`);
			console.log(`  Model: ${effectiveModel}`);
			console.log(`  API Key: ${redactApiKey(providerConfig?.apiKey)}`);
			if (providerConfig?.baseUrl) {
				console.log(`  Base URL: ${providerConfig.baseUrl}`);
			}
			if (effectiveThinking?.enabled) {
				console.log(
					`  Thinking: enabled (effort: ${effectiveThinking.effort ?? "medium"}, budget: ${effectiveThinking.budgetTokens ?? "default"})`
				);
			}
			console.log(`  System Prompt: ${this._systemPrompt.length} chars`);
			console.log(`  Messages: ${messages.length}`);
			console.log(`  Tools: ${tools.length}`);
			console.log(`  maxContextTokens: ${this._maxContextTokens}`);
			if (this._memoryStore) {
				console.log(`  Memory: ${this._memoryStore.count()} memories stored`);
			}
			console.log("");
		}

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

				if (this._verbose) {
					console.log(`\n[Iteration ${iteration + 1}]`);
					if (this._trackContextUsage) {
						console.log(
							`[Context: ${contextStats.totalTokens}/${contextStats.maxContextTokens} - ` +
								`sys: ${contextStats.systemPromptTokens}t, mem: ${contextStats.memoryTokens}t, ` +
								`conv: ${contextStats.conversationTokens}t]`
						);
					}
				}

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

				if (this._verbose) {
					console.log(`LLM Response: ${fullContent}`);
					if (responseToolCalls.length > 0) {
						console.log(`Tool Calls: ${responseToolCalls.join(", ")}`);
					}
				}

				const assistantMessage: Message = {
					role: "assistant",
					content: fullContent,
				};

				messages.push(assistantMessage);

				if (assistantToolCalls.length > 0) {
					assistantMessage.toolCalls = assistantToolCalls;
				}

				if (assistantToolCalls.length === 0) {
					if (this._verbose) {
						console.log(`\nAgent finished after ${iteration + 1} iteration(s)`);
					}

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
				if (this._verbose) {
					console.log(`\n[Loop detected - requesting final answer from LLM]`);
				}

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

			if (this._verbose) {
				console.log(`\n[Agent reached max iterations (${this._maxIterations})]`);
			}

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
		return this._skills;
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
		if (!this._skillsInitPromise) return;
		await this._skillsInitPromise;
	}

	async loadSkill(
		skillName: string
	): Promise<{ content: string; wrappedContent: string; allowedTools?: string[] } | null> {
		const skillMetadata = this._skills.get(skillName);
		if (!skillMetadata) return null;

		try {
			let content: string;
			let baseDir = ".";

			if (skillMetadata.location.startsWith("builtin://")) {
				const embeddedContent = getEmbeddedSkillContent(skillName);
				if (!embeddedContent) {
					throw new Error(`Built-in skill content not found: ${skillName}`);
				}
				content = embeddedContent;
			} else {
				content = await fs.readFile(skillMetadata.location, "utf-8");
				baseDir = path.dirname(skillMetadata.location);
			}

			let allowedTools: string[] | undefined;
			try {
				const parsed = parseSkillFrontmatter(content);
				allowedTools = parsed.frontmatter.allowedTools;
			} catch {
				console.warn(`[WARN] Could not parse frontmatter for skill: ${skillName}`);
			}

			if (allowedTools) {
				this._setSkillRestriction(allowedTools);
			} else {
				this._clearSkillRestriction();
			}

			const escapedContent = escapeXml(content);
			const wrappedContent = `<loaded_skill name="${skillName}" base_dir="${baseDir}">\n${escapedContent}\n</loaded_skill>`;

			return { content, wrappedContent, allowedTools };
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (error.code === "ENOENT") {
				throw new Error(`Skill file not found: ${skillMetadata.location}`);
			}
			throw new Error(`Error reading skill: ${error.message}`);
		}
	}

	_setSkillRestriction(allowedTools: string[] | undefined): void {
		this._activeSkillAllowedTools = allowedTools;
	}

	_clearSkillRestriction(): void {
		this._activeSkillAllowedTools = undefined;
	}

	async healthCheck(): Promise<HealthStatus> {
		const issues: string[] = [];

		if (!this._defaultLlmClient) {
			issues.push("No default LLM client configured");
		}

		if (this._providerConfigs && Object.keys(this._providerConfigs).length === 0) {
			issues.push("Provider configs empty");
		}

		if (issues.length > 0) {
			return {
				ready: false,
				issues,
				providerCount: this._providerCache.size,
				skillCount: this._skills.size,
				memoryEnabled: !!this._memoryStore,
				mcpServers: this._mcpManager?.getServerStatus() ?? [],
			};
		}

		return {
			ready: true,
			issues,
			providerCount: this._providerCache.size,
			skillCount: this._skills.size,
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

	private _getToolDefinitions(): ToolDefinition[] {
		const allTools = this._toolRegistry.list().map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		}));

		if (!this._activeSkillAllowedTools?.length) {
			return allTools;
		}

		const allowedSet = new Set(this._activeSkillAllowedTools);
		return allTools.filter((tool) => allowedSet.has(tool.name));
	}
}
