import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadAgentsMd } from "../config/loader.js";
import type { ProviderConfig, ThinkingConfig } from "../config/schema.js";
import type { McpManager } from "../mcp/manager.js";
import { createProvider, detectProvider, parseModelString } from "../providers/factory.js";
import type { LLMClient, Message, ToolDefinition } from "../providers/types.js";
import { getEmbeddedSkillContent } from "../skills/builtin-registry.js";
import { discoverSkills, generateSkillsPrompt, getBuiltinSkillsDir, type SkillMetadata } from "../skills/index.js";
import { parseSkillFrontmatter } from "../skills/parser.js";
import type { ToolRegistry } from "../tools/registry.js";
import { escapeXml } from "../utils/xml.js";
import { ConversationManager } from "./conversation.js";
import { buildContextWithMemory, type ContextStats, calculateContextBudget, MemoryStore } from "./memory.js";
import { countTokensSync, truncateMessages } from "./tokens.js";

const MAX_OUTPUT_LENGTH = 500;

// Loop detection thresholds
const LOOP_DETECTION = {
	MIN_RECENT_CALLS: 3,
	IDENTICAL_REPEAT: 3,
	SAME_TOOL_THRESHOLD: 5,
	DOMINANT_TOOL_THRESHOLD: 8,
	LOOKBACK_WINDOW: 10,
} as const;

export function checkAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException("Aborted", "AbortError");
	}
}

export function isLooping(recentToolCalls: string[]): boolean {
	if (recentToolCalls.length < LOOP_DETECTION.MIN_RECENT_CALLS) return false;

	const extractTool = (call: string): string => call.match(/^([^:]+):/)?.[1] ?? "";
	const lastCall = recentToolCalls[recentToolCalls.length - 1] ?? "";
	const lastTool = extractTool(lastCall);

	if (recentToolCalls.slice(-LOOP_DETECTION.IDENTICAL_REPEAT).every((c) => c === lastCall)) return true;

	if (recentToolCalls.length >= LOOP_DETECTION.SAME_TOOL_THRESHOLD) {
		const lastFive = recentToolCalls.slice(-LOOP_DETECTION.SAME_TOOL_THRESHOLD);
		if (lastFive.every((c) => extractTool(c) === lastTool)) return true;
	}

	if (recentToolCalls.length >= LOOP_DETECTION.LOOKBACK_WINDOW) {
		const counts: Record<string, number> = {};
		for (const call of recentToolCalls.slice(-LOOP_DETECTION.LOOKBACK_WINDOW)) {
			const tool = extractTool(call);
			counts[tool] = (counts[tool] ?? 0) + 1;
		}
		if (Math.max(...Object.values(counts), 0) >= LOOP_DETECTION.DOMINANT_TOOL_THRESHOLD) return true;
	}

	return false;
}

export function redactApiKey(key?: string): string {
	if (!key) return "(not set)";
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}...REDACTED`;
}

export function truncateOutput(output: string | undefined): string | undefined {
	if (!output) return output;
	const lines = output.split("\n");
	if (lines.length > 10) {
		return `${lines.slice(0, 10).join("\n")}\n... (${lines.length - 10} more lines)`;
	}
	if (output.length > MAX_OUTPUT_LENGTH) {
		return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n... (${output.length - MAX_OUTPUT_LENGTH} more chars)`;
	}
	return output;
}

function calculateMessageTokens(messages: Message[]): number {
	return messages.reduce((sum, msg) => sum + countTokensSync(msg.content), 0);
}

export interface ProviderConfigs {
	openai?: ProviderConfig;
	anthropic?: ProviderConfig;
	ollama?: ProviderConfig;
	ollamaCloud?: ProviderConfig;
	openrouter?: ProviderConfig;
	opencode?: ProviderConfig;
	zai?: ProviderConfig;
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

export interface AgentStreamChunk {
	content: string;
	iterations: number;
	done: boolean;
	toolCalls?: string[];
	toolExecutions?: ToolExecution[];
	contextStats?: ContextStats;
	maxIterationsReached?: boolean;
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

interface BuildStatsParams {
	systemTokens: number;
	memoryTokens: number;
	convTokens: number;
	truncationApplied: boolean;
	maxContextTokens: number;
}

function buildStats({
	systemTokens,
	memoryTokens,
	convTokens,
	truncationApplied,
	maxContextTokens,
}: BuildStatsParams): ContextStats {
	return {
		systemPromptTokens: systemTokens,
		memoryTokens,
		conversationTokens: convTokens,
		totalTokens: systemTokens + memoryTokens + convTokens,
		maxContextTokens,
		truncationApplied,
		memoryCount: 0,
	};
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

		let contextStats: ContextStats;
		let memoryTokensUsed = 0;
		let truncationApplied = false;

		const systemTokens = countTokensSync(this._systemPrompt);
		const maxContextTokens = this._maxContextTokens ?? 0;

		if (!this._maxContextTokens) {
			contextStats = buildStats({
				systemTokens,
				memoryTokens: 0,
				convTokens: calculateMessageTokens(messages),
				truncationApplied: false,
				maxContextTokens,
			});
		} else if (this._memoryStore) {
			const { memoryBudget, conversationBudget } = calculateContextBudget(
				this._maxContextTokens,
				systemTokens,
				this._maxMemoryTokens,
				{ memoryBudgetPercent: this._memoryBudgetPercent }
			);

			const relevantMemories = this._memoryStore.findRelevant(userPrompt, 10);
			const result = buildContextWithMemory(
				this._systemPrompt,
				relevantMemories,
				messages,
				memoryBudget,
				conversationBudget
			);

			messages = result.context as Message[];
			contextStats = result.stats;
			memoryTokensUsed = result.stats.memoryTokens;
			truncationApplied = result.stats.truncationApplied;
		} else {
			const availableTokens = this._maxContextTokens - systemTokens - 1000;
			if (availableTokens > 0) {
				const truncated = await truncateMessages(messages, availableTokens);
				truncationApplied = truncated.length < messages.length;
				if (truncationApplied) messages = truncated as Message[];
			}
			contextStats = buildStats({
				systemTokens,
				memoryTokens: 0,
				convTokens: calculateMessageTokens(messages),
				truncationApplied,
				maxContextTokens,
			});
		}

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
		const recentToolCalls: string[] = [];
		let loopDetected = false;

		const updateStats = (): ContextStats =>
			buildStats({
				systemTokens,
				memoryTokens: memoryTokensUsed,
				convTokens: calculateMessageTokens(messages),
				truncationApplied,
				maxContextTokens,
			});

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

			const stream = llmClient.stream({
				model: modelName,
				messages: [
					{
						role: "system",
						content: this._systemPrompt,
					},
					...messages,
				],
				tools: tools.length > 0 ? tools : undefined,
				thinking: effectiveThinking,
				signal: options?.signal,
			});

			let fullContent = "";
			let responseToolCalls: string[] = [];
			const assistantToolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

			for await (const chunk of stream) {
				if (chunk.content) {
					if (!isValidToolCall(chunk.content)) {
						fullContent += chunk.content;
						yield {
							content: chunk.content,
							iterations: iteration + 1,
							done: false,
							contextStats,
						};
					}
				}

				if (chunk.toolCalls) {
					assistantToolCalls.push(...chunk.toolCalls);
					responseToolCalls = chunk.toolCalls.map((tc) => tc.name);
				}
			}

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
				};
				return;
			}

			checkAborted(options?.signal);

			const toolStartTime = Date.now();

			yield {
				content: "",
				iterations: iteration + 1,
				done: false,
				toolExecutions: assistantToolCalls.map((tc) => ({
					name: tc.name,
					status: "running" as const,
					args: tc.arguments,
					startTime: toolStartTime,
				})),
				contextStats,
			};

			const calls = assistantToolCalls.map((tc) => ({
				name: tc.name,
				args: tc.arguments,
			}));
			const batchResults = await this._toolRegistry.executeBatch(calls);

			const toolEndTime = Date.now();
			const toolDuration = toolEndTime - toolStartTime;

			const resultMap = new Map(batchResults.map((br) => [br.name, br]));
			const getToolResult = (name: string) => resultMap.get(name)?.result;
			const toolExecutionResults = assistantToolCalls.map((tc) => ({
				toolCall: tc,
				result: getToolResult(tc.name) ?? {
					success: false,
					error: `Tool "${tc.name}" result not found`,
				},
			}));

			yield {
				content: "",
				iterations: iteration + 1,
				done: false,
				toolExecutions: toolExecutionResults.map(({ toolCall, result }) => ({
					name: toolCall?.name,
					status: result.success ? "complete" : "error",
					args: toolCall?.arguments,
					output: result.success ? truncateOutput(result.output) : undefined,
					error: result.error ? truncateOutput(result.error) : undefined,
					duration: toolDuration,
				})),
				contextStats,
			};

			checkAborted(options?.signal);

			for (const { toolCall, result } of toolExecutionResults) {
				const toolCallSignature = `${toolCall?.name}:${JSON.stringify(toolCall?.arguments)}`;
				recentToolCalls.push(toolCallSignature);

				messages.push({
					role: "tool",
					content: result.error || result.output || "(no output)",
					toolCallId: toolCall?.id,
				});
			}

			const notFoundErrors = toolExecutionResults.filter(
				({ result }) => !result.success && result.error?.includes("not found")
			);
			const declinedErrors = toolExecutionResults.filter(
				({ result }) => !result.success && result.error?.includes("User declined confirmation")
			);

			if (notFoundErrors.length > 0) {
				const missingTools = notFoundErrors.map(({ toolCall }) => toolCall?.name).join(", ");
				messages.push({
					role: "system",
					content: `ERROR: The following tool(s) are not available: ${missingTools}. Please stop and provide your final answer based on the information you have gathered, or ask the user for alternative approaches.`,
				});
				if (this._verbose) {
					console.log(`\n[WARNING] Tool(s) not found: ${missingTools}, breaking loop`);
				}
				loopDetected = true;
				break;
			}

			if (declinedErrors.length > 0) {
				const declinedTools = declinedErrors.map(({ toolCall }) => toolCall?.name).join(", ");

				if (declinedErrors.length === toolExecutionResults.length) {
					messages.push({
						role: "system",
						content: `All tool calls (${declinedTools}) were declined by the user. Provide your final answer now without making any more tool calls.`,
					});
					if (this._verbose) {
						console.log(`\n[INFO] All tools declined: ${declinedTools}, requesting final answer`);
					}
					loopDetected = true;
					break;
				}

				if (this._verbose) {
					console.log(`\n[INFO] User declined confirmation: ${declinedTools}, continuing with remaining tools`);
				}
				contextStats = updateStats();
				continue;
			}

			if (recentToolCalls.length >= 3 && isLooping(recentToolCalls)) {
				const toolName = assistantToolCalls[0]?.name ?? "unknown";
				messages.push({
					role: "system",
					content: `STOP: You have called ${toolName} repeatedly with the same arguments. Please stop and use the results you already have, or try a different approach. Provide your final answer now based on the information you have gathered.`,
				});
				if (this._verbose) {
					console.log(`\n[WARNING] Detected tool call loop for ${toolName}, breaking loop`);
				}
				loopDetected = true;
				break;
			}

			contextStats = updateStats();
		}

		if (loopDetected) {
			if (this._verbose) {
				console.log(`\n[Loop detected - requesting final answer from LLM]`);
			}

			const stream = llmClient.stream({
				model: modelName,
				messages: [
					{
						role: "system",
						content: this._systemPrompt,
					},
					...messages,
				],
				tools: undefined,
				thinking: effectiveThinking,
				signal: options?.signal,
			});

			for await (const chunk of stream) {
				if (chunk.content) {
					yield {
						content: chunk.content,
						iterations: iteration + 1,
						done: false,
						contextStats: updateStats(),
					};
				}
			}

			await this._updateConversationHistory(messages);
			yield {
				content: "",
				iterations: iteration + 1,
				done: true,
				contextStats: updateStats(),
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
		};
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
