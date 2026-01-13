import type { LLMClient, Message } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../providers/types.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { countTokens, truncateMessages } from "./tokens.js";

export interface AgentOptions {
  maxIterations?: number;
  systemPrompt?: string;
  verbose?: boolean;
  conversationFile?: string;
  maxContextTokens?: number;
}

export interface AgentStreamChunk {
  content: string;
  iterations: number;
  done: boolean;
  toolCalls?: string[];
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

  constructor(llmClient: LLMClient, toolRegistry: ToolRegistry, options: AgentOptions = {}) {
    this._llmClient = llmClient;
    this._toolRegistry = toolRegistry;
    this._maxIterations = options.maxIterations ?? 20;
    this._systemPrompt =
      options.systemPrompt ??
      "You are a helpful AI assistant with access to tools. Use available tools to help the user. When you have enough information to answer, provide your final response.";
    this._verbose = options.verbose ?? false;
    this._conversationFile = options.conversationFile;
    this._maxContextTokens = options.maxContextTokens;
  }

  async *runStream(
    userPrompt: string,
    model: string,
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    // Load previous conversation if file is configured and exists
    let messages = this._conversationFile ? this._loadConversation() : [];

    // If no previous conversation, start fresh with system prompt context
    if (messages.length === 0) {
      messages = [
        {
          role: "user",
          content: userPrompt,
        },
      ];
    } else {
      // Add new user prompt to existing conversation
      messages.push({
        role: "user",
        content: userPrompt,
      });
    }

    // Manage context window if maxContextTokens is configured
    if (this._maxContextTokens) {
      const systemTokens = countTokens(this._systemPrompt);
      const availableTokens = this._maxContextTokens - systemTokens - 1000; // Reserve 1000 tokens for response

      if (availableTokens > 0) {
        messages = truncateMessages(messages, availableTokens);
      }
    }

    // Get tool definitions for LLM
    const tools = this._getToolDefinitions();

    let iteration = 0;

    for (iteration = 0; iteration < this._maxIterations; iteration++) {
      if (this._verbose) {
        console.log(`\n[Iteration ${iteration + 1}]`);
      }

      // Call LLM with streaming
      const stream = this._llmClient.stream({
        model,
        messages: [
          {
            role: "system",
            content: this._systemPrompt,
          },
          ...messages,
        ],
        tools: tools.length > 0 ? tools : undefined,
      });

      let fullContent = "";
      let responseToolCalls: string[] = [];
      const assistantToolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] =
        [];

      for await (const chunk of stream) {
        if (chunk.content) {
          fullContent += chunk.content;
          yield {
            content: chunk.content,
            iterations: iteration + 1,
            done: false,
          };
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

      // If no tool calls or stop finish reason, we're done
      if (assistantToolCalls.length === 0) {
        if (this._verbose) {
          console.log(`\nAgent finished after ${iteration + 1} iteration(s)`);
        }

        // Save conversation if file is configured
        this._saveConversation(messages);

        yield {
          content: "",
          iterations: iteration + 1,
          done: true,
        };
        return;
      }

      // Execute tool calls
      for (const toolCall of assistantToolCalls) {
        if (this._verbose) {
          console.log(`\nExecuting tool: ${toolCall.name} with args:`, toolCall.arguments);
        }

        const result = await this._toolRegistry.execute(toolCall.name, toolCall.arguments);

        if (this._verbose) {
          console.log(`Tool result: ${result.error || result.output || "(no output)"}`);
        }

        messages.push({
          role: "tool",
          content: result.error || result.output || "(no output)",
          toolCallId: toolCall.id,
        });
      }
    }

    // Max iterations reached
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
