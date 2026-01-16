import type { LLMClient, Message } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../providers/types.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { countTokens, truncateMessages } from "./tokens.js";
import {
  MemoryStore,
  calculateContextBudget,
  buildContextWithMemory,
  type ContextStats,
} from "./memory.js";
import { z } from "zod";
import { loadAgentsMd } from "../config/loader.js";
import type { ThinkingConfig } from "../config/schema.js";

export interface AgentOptions {
  maxIterations?: number;
  systemPrompt?: string;
  verbose?: boolean;
  conversationFile?: string;
  maxContextTokens?: number;
  memoryFile?: string;
  maxMemoryTokens?: number;
  trackContextUsage?: boolean;
  agentsMdPath?: string;
  thinking?: ThinkingConfig;
}

export interface RuntimeConfig {
  model?: string;
  thinking?: ThinkingConfig;
}

export interface ToolExecution {
  name: string;
  status: "running" | "complete" | "error";
  summary?: string;
}

export interface AgentStreamChunk {
  content: string;
  iterations: number;
  done: boolean;
  toolCalls?: string[];
  toolExecutions?: ToolExecution[];
  contextStats?: ContextStats;
}

export interface AgentResponse {
  content: string;
  iterations: number;
  messages: Message[];
}

export class Agent {
  private _llmClient: LLMClient;
  private _toolRegistry: ToolRegistry;
  private _maxIterations: number;
  private _systemPrompt: string;
  private _verbose: boolean;
  private _conversationFile?: string;
  private _maxContextTokens?: number;
  private _memoryStore?: MemoryStore;
  private _maxMemoryTokens?: number;
  private _trackContextUsage: boolean;
  private _thinking?: ThinkingConfig;
  private _conversationHistory: Message[] = [];

  constructor(llmClient: LLMClient, toolRegistry: ToolRegistry, options: AgentOptions = {}) {
    this._llmClient = llmClient;
    this._toolRegistry = toolRegistry;
    this._maxIterations = options.maxIterations ?? 20;

    let effectiveSystemPrompt =
      options.systemPrompt ??
      "You are a helpful AI assistant with access to tools. Use available tools to help the user. When you have enough information to answer, provide your final response.";

    if (options.agentsMdPath) {
      const agentsMdContent = loadAgentsMd(options.agentsMdPath);
      if (agentsMdContent) {
        effectiveSystemPrompt = `${agentsMdContent}\n\n---\n\n${effectiveSystemPrompt}`;
        if (options.verbose) {
          console.log(`[Loaded AGENTS.md from ${options.agentsMdPath}]`);
        }
      }
    }

    this._systemPrompt = effectiveSystemPrompt;
    this._verbose = options.verbose ?? false;
    this._conversationFile = options.conversationFile;
    this._maxContextTokens = options.maxContextTokens;
    this._maxMemoryTokens = options.maxMemoryTokens;
    this._trackContextUsage = options.trackContextUsage ?? false;
    this._thinking = options.thinking;

    if (options.memoryFile) {
      this._memoryStore = new MemoryStore({ filePath: options.memoryFile });
    }
  }

  startChatSession(): void {
    this._conversationHistory = [];
  }

  _updateConversationHistory(messages: Message[]): void {
    this._saveConversation(messages);
    this._conversationHistory = messages;
  }

  async *runStream(
    userPrompt: string,
    model: string,
    runtimeConfig?: RuntimeConfig,
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    const effectiveModel = runtimeConfig?.model ?? model;
    const effectiveThinking = runtimeConfig?.thinking ?? this._thinking;

    let messages: Message[];

    if (this._conversationFile) {
      messages = this._loadConversation();
    } else {
      messages = this._conversationHistory;
    }

    if (messages.length === 0) {
      messages = [{ role: "user", content: userPrompt }];
    } else {
      messages.push({ role: "user", content: userPrompt });
    }

    const updateContextStats = (memoryTokens: number, truncationApplied: boolean): ContextStats => {
      const systemTokens = countTokens(this._systemPrompt);
      let conversationTokens = 0;
      for (const msg of messages) {
        conversationTokens += countTokens(msg.content);
      }
      return {
        systemPromptTokens: systemTokens,
        memoryTokens,
        conversationTokens,
        totalTokens: systemTokens + memoryTokens + conversationTokens,
        maxContextTokens: this._maxContextTokens ?? 0,
        truncationApplied,
        memoryCount: 0,
      };
    };

    let contextStats: ContextStats | undefined;
    let memoryTokensUsed = 0;
    let truncationApplied = false;

    if (this._maxContextTokens && this._memoryStore) {
      const systemTokens = countTokens(this._systemPrompt);
      const { memoryBudget, conversationBudget } = calculateContextBudget(
        this._maxContextTokens,
        systemTokens,
        this._maxMemoryTokens,
      );

      const relevantMemories = this._memoryStore.findRelevant(userPrompt, 10);
      const result = buildContextWithMemory(
        this._systemPrompt,
        relevantMemories,
        messages,
        memoryBudget,
        conversationBudget,
      );

      messages = result.context as Message[];
      contextStats = result.stats;
      memoryTokensUsed = result.stats.memoryTokens;
      truncationApplied = result.stats.truncationApplied;
    } else if (this._maxContextTokens) {
      const systemTokens = countTokens(this._systemPrompt);
      const availableTokens = this._maxContextTokens - systemTokens - 1000;

      if (availableTokens > 0) {
        const truncated = truncateMessages(messages, availableTokens);
        if (truncated.length < messages.length) {
          messages = truncated as Message[];
          truncationApplied = true;
        }
      }

      contextStats = updateContextStats(0, truncationApplied);
    }

    const tools = this._getToolDefinitions();

    let iteration = 0;
    const recentToolCalls: string[] = [];
    let loopDetected = false;

    for (iteration = 0; iteration < this._maxIterations; iteration++) {
      if (!contextStats) {
        contextStats = updateContextStats(memoryTokensUsed, truncationApplied);
      }

      if (this._verbose) {
        console.log(`\n[Iteration ${iteration + 1}]`);
        if (this._trackContextUsage) {
          console.log(
            `[Context: ${contextStats.totalTokens}/${contextStats.maxContextTokens} - ` +
              `sys: ${contextStats.systemPromptTokens}t, mem: ${contextStats.memoryTokens}t, ` +
              `conv: ${contextStats.conversationTokens}t]`,
          );
        }
      }

      const stream = this._llmClient.stream({
        model: effectiveModel,
        messages: [
          {
            role: "system",
            content: this._systemPrompt,
          },
          ...messages,
        ],
        tools: tools.length > 0 ? tools : undefined,
        thinking: effectiveThinking,
      });

      let fullContent = "";
      let responseToolCalls: string[] = [];
      const assistantToolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] =
        [];

      const toolCallSchema = z.object({
        name: z.string(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      });

      const isValidToolCall = (text: string): boolean => {
        try {
          const parsed = JSON.parse(text);
          return toolCallSchema.safeParse(parsed).success;
        } catch {
          return false;
        }
      };

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

      // Add assistant's response to messages
      const assistantMessage: Message = {
        role: "assistant",
        content: fullContent,
      };

      if (assistantToolCalls.length > 0) {
        assistantMessage.toolCalls = assistantToolCalls;
      }

      messages.push(assistantMessage);

      if (assistantToolCalls.length === 0) {
        if (this._verbose) {
          console.log(`\nAgent finished after ${iteration + 1} iteration(s)`);
        }

        this._updateConversationHistory(messages);

        yield {
          content: "",
          iterations: iteration + 1,
          done: true,
          contextStats,
        };
        return;
      }

      yield {
        content: "",
        iterations: iteration + 1,
        done: false,
        toolExecutions: assistantToolCalls.map((tc) => ({
          name: tc.name,
          status: "running" as const,
        })),
        contextStats,
      };

      const toolExecutionPromises = assistantToolCalls.map(async (toolCall) => {
        if (this._verbose) {
          console.log(`\nExecuting tool: ${toolCall.name} with args:`, toolCall.arguments);
        }

        const result = await this._toolRegistry.execute(toolCall.name, toolCall.arguments);

        if (this._verbose) {
          console.log(`Tool result: ${result.error || result.output || "(no output)"}`);
        }

        return {
          toolCall,
          result,
        };
      });

      const toolExecutionResults = await Promise.all(toolExecutionPromises);

      yield {
        content: "",
        iterations: iteration + 1,
        done: false,
        toolExecutions: toolExecutionResults.map(({ toolCall, result }) => ({
          name: toolCall.name,
          status: result.success ? "complete" : "error",
          summary: result.error ? "Failed" : undefined,
        })),
        contextStats,
      };

      for (const { toolCall, result } of toolExecutionResults) {
        const toolCallSignature = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
        recentToolCalls.push(toolCallSignature);

        messages.push({
          role: "tool",
          content: result.error || result.output || "(no output)",
          toolCallId: toolCall.id,
        });
      }

      // Check for "not found" errors - these are fatal and should stop the loop
      const notFoundErrors = toolExecutionResults.filter(
        ({ result }) => !result.success && result.error?.includes("not found"),
      );

      if (notFoundErrors.length > 0) {
        const missingTools = notFoundErrors.map(({ toolCall }) => toolCall.name).join(", ");
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

      if (recentToolCalls.length >= 3) {
        const lastThree = recentToolCalls.slice(-3);
        if (lastThree.every((call) => call === lastThree[0])) {
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
      }

      contextStats = updateContextStats(memoryTokensUsed, truncationApplied);
    }

    if (loopDetected) {
      if (this._verbose) {
        console.log(`\n[Loop detected - requesting final answer from LLM]`);
      }

      const stream = this._llmClient.stream({
        model: effectiveModel,
        messages: [
          {
            role: "system",
            content: this._systemPrompt,
          },
          ...messages,
        ],
        tools: undefined,
        thinking: effectiveThinking,
      });

      for await (const chunk of stream) {
        if (chunk.content) {
          yield {
            content: chunk.content,
            iterations: iteration + 1,
            done: false,
            contextStats: updateContextStats(memoryTokensUsed, truncationApplied),
          };
        }
      }

      this._updateConversationHistory(messages);
      yield {
        content: "",
        iterations: iteration + 1,
        done: true,
        contextStats: updateContextStats(memoryTokensUsed, truncationApplied),
      };
      return;
    }

    throw new Error(`Agent reached max iterations (${this._maxIterations}) without finishing`);
  }

  async run(userPrompt: string, model: string): Promise<AgentResponse> {
    const messages: Message[] = [];
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
      messages,
    };
  }

  private _getToolDefinitions(): ToolDefinition[] {
    return this._toolRegistry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    }));
  }

  private _loadConversation(): Message[] {
    if (!this._conversationFile || !existsSync(this._conversationFile)) {
      return [];
    }

    try {
      const content = readFileSync(this._conversationFile, "utf-8");
      const data = JSON.parse(content);
      return data.messages || [];
    } catch (err) {
      console.error(`Warning: Failed to load conversation from ${this._conversationFile}: ${err}`);
      return [];
    }
  }

  private _saveConversation(messages: Message[]): void {
    if (!this._conversationFile) {
      return;
    }

    try {
      const data = {
        timestamp: new Date().toISOString(),
        messages,
      };
      writeFileSync(this._conversationFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error(`Warning: Failed to save conversation to ${this._conversationFile}: ${err}`);
    }
  }
}
