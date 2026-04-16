/**
 * Anthropic Console OAuth Provider
 *
 * Adds "Anthropic Console account" as a login option in pi,
 * authenticating against the Console (organization/API billing)
 * instead of the personal claude.ai subscription.
 *
 * Usage:
 *   1. Install deps: cd ~/.config/pi/extensions/anthropic-console && npm install
 *   2. Restart pi (or /reload)
 *   3. /login → select "Anthropic Console account · API usage billing"
 *   4. /model → select an anthropic-console model
 */

import Anthropic from "@anthropic-ai/sdk";
import {
    type Api,
    type AssistantMessage,
    type AssistantMessageEventStream,
    type Context,
    type ImageContent,
    type Message,
    type Model,
    type SimpleStreamOptions,
    type TextContent,
    type ThinkingContent,
    type Tool,
    type ToolCall,
    type ToolResultMessage,
    calculateCost,
    createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerHooks } from "./hooks/index.js";
import { FALLBACK_MODELS } from "./models/index.js";
import { login, refreshToken } from "./oauth/index.js";

// =============================================================================
// Streaming — Minimal Anthropic API streaming using the SDK directly
// =============================================================================

function sanitizeSurrogates(text: string): string {
    return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

function supportsAdaptiveThinking(modelId: string): boolean {
    return modelId.includes("opus-4-6") || modelId.includes("opus-4.6")
        || modelId.includes("opus-4-7") || modelId.includes("opus-4.7")
        || modelId.includes("sonnet-4-6") || modelId.includes("sonnet-4.6");
}

type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

function isOpus47OrLater(modelId: string): boolean {
    const match = modelId.match(/opus-?(\d+)[-.](\d+)/);
    if (!match) return false;
    const [, major, minor] = match;
    return Number(major) > 4 || (Number(major) === 4 && Number(minor) >= 7);
}

function mapReasoningToEffort(level: SimpleStreamOptions["reasoning"], modelId: string): AnthropicEffort {
    const isOpus = modelId.includes("opus");
    switch (level) {
        case "minimal": case "low": return "low";
        case "medium": return "medium";
        case "high": return "high";
        case "xhigh": return isOpus47OrLater(modelId) ? "xhigh" : isOpus ? "max" : "high";
        default: return "high";
    }
}

function convertContentBlocks(content: (TextContent | ImageContent)[]): string | any[] {
    const hasImages = content.some((c) => c.type === "image");
    if (!hasImages) return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));

    const blocks = content.map((block) => {
        if (block.type === "text") return { type: "text" as const, text: sanitizeSurrogates(block.text) };
        return { type: "image" as const, source: { type: "base64" as const, media_type: block.mimeType, data: block.data } };
    });
    if (!blocks.some((b) => b.type === "text")) blocks.unshift({ type: "text" as const, text: "(see attached image)" });
    return blocks;
}

function convertMessages(messages: Message[]): any[] {
    const params: any[] = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (msg.role === "user") {
            if (typeof msg.content === "string") {
                if (msg.content.trim()) params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
            } else {
                const blocks = msg.content.map((item) =>
                    item.type === "text"
                        ? { type: "text" as const, text: sanitizeSurrogates(item.text) }
                        : { type: "image" as const, source: { type: "base64" as const, media_type: item.mimeType as any, data: item.data } }
                );
                if (blocks.length > 0) params.push({ role: "user", content: blocks });
            }
        } else if (msg.role === "assistant") {
            const blocks: any[] = [];
            for (const block of msg.content) {
                if (block.type === "text" && block.text.trim()) {
                    blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
                } else if (block.type === "thinking" && block.thinking.trim()) {
                    if ((block as ThinkingContent).redacted) {
                        blocks.push({ type: "redacted_thinking", data: (block as ThinkingContent).thinkingSignature });
                    } else if ((block as ThinkingContent).thinkingSignature) {
                        blocks.push({ type: "thinking", thinking: sanitizeSurrogates(block.thinking), signature: (block as ThinkingContent).thinkingSignature });
                    } else {
                        blocks.push({ type: "text", text: sanitizeSurrogates(block.thinking) });
                    }
                } else if (block.type === "toolCall") {
                    blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.arguments });
                }
            }
            if (blocks.length > 0) params.push({ role: "assistant", content: blocks });
        } else if (msg.role === "toolResult") {
            const toolResults: any[] = [{ type: "tool_result", tool_use_id: msg.toolCallId, content: convertContentBlocks(msg.content), is_error: msg.isError }];
            let j = i + 1;
            while (j < messages.length && messages[j].role === "toolResult") {
                const next = messages[j] as ToolResultMessage;
                toolResults.push({ type: "tool_result", tool_use_id: next.toolCallId, content: convertContentBlocks(next.content), is_error: next.isError });
                j++;
            }
            i = j - 1;
            params.push({ role: "user", content: toolResults });
        }
    }

    // Cache control on last user message
    if (params.length > 0) {
        const last = params[params.length - 1];
        if (last.role === "user" && Array.isArray(last.content)) {
            const lastBlock = last.content[last.content.length - 1];
            if (lastBlock) lastBlock.cache_control = { type: "ephemeral" };
        }
    }

    return params;
}

function convertTools(tools: Tool[]): any[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: { type: "object", properties: (tool.parameters as any).properties || {}, required: (tool.parameters as any).required || [] },
    }));
}

function mapStopReason(reason: string): "stop" | "length" | "toolUse" | "error" {
    switch (reason) {
        case "end_turn": case "pause_turn": case "stop_sequence": return "stop";
        case "max_tokens": return "length";
        case "tool_use": return "toolUse";
        default: return "error";
    }
}

function streamConsole(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();

    (async () => {
        const output: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
        };

        try {
            const apiKey = options?.apiKey ?? "";
            const betaFeatures = ["fine-grained-tool-streaming-2025-05-14"];
            if (!supportsAdaptiveThinking(model.id)) betaFeatures.push("interleaved-thinking-2025-05-14");

            const client = new Anthropic({
                apiKey,
                baseURL: model.baseUrl,
                dangerouslyAllowBrowser: true,
                defaultHeaders: {
                    "accept": "application/json",
                    "anthropic-dangerous-direct-browser-access": "true",
                    "anthropic-beta": `claude-code-20250219,${betaFeatures.join(",")}`,
                    "user-agent": "claude-cli/2.1.85",
                    "x-app": "cli",
                },
            });

            const params: any = {
                model: model.id,
                messages: convertMessages(context.messages),
                max_tokens: options?.maxTokens || Math.floor(model.maxTokens / 3),
                stream: true,
            };

            params.system = [
                { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: "ephemeral" } },
            ];
            if (context.systemPrompt) {
                params.system.push({ type: "text", text: sanitizeSurrogates(context.systemPrompt), cache_control: { type: "ephemeral" } });
            }

            if (context.tools) params.tools = convertTools(context.tools);

            if (model.reasoning && options?.reasoning) {
                if (supportsAdaptiveThinking(model.id)) {
                    params.thinking = { type: "adaptive" };
                    params.output_config = { effort: mapReasoningToEffort(options.reasoning, model.id) };
                } else {
                    const budgets: Record<string, number> = { minimal: 1024, low: 4096, medium: 10240, high: 20480 };
                    params.thinking = { type: "enabled", budget_tokens: options.thinkingBudgets?.[options.reasoning as keyof typeof options.thinkingBudgets] ?? budgets[options.reasoning] ?? 10240 };
                }
            }

            const anthropicStream = client.messages.stream({ ...params }, { signal: options?.signal });
            stream.push({ type: "start", partial: output });

            type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
            const blocks = output.content as Block[];

            for await (const event of anthropicStream) {
                if (event.type === "message_start") {
                    output.responseId = event.message.id;
                    output.usage.input = event.message.usage.input_tokens || 0;
                    output.usage.output = event.message.usage.output_tokens || 0;
                    output.usage.cacheRead = (event.message.usage as any).cache_read_input_tokens || 0;
                    output.usage.cacheWrite = (event.message.usage as any).cache_creation_input_tokens || 0;
                    output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
                    calculateCost(model, output.usage);
                } else if (event.type === "content_block_start") {
                    if (event.content_block.type === "text") {
                        output.content.push({ type: "text", text: "", index: event.index } as any);
                        stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
                    } else if (event.content_block.type === "thinking") {
                        output.content.push({ type: "thinking", thinking: "", thinkingSignature: "", index: event.index } as any);
                        stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
                    } else if ((event.content_block as any).type === "redacted_thinking") {
                        output.content.push({ type: "thinking", thinking: "[Reasoning redacted]", thinkingSignature: (event.content_block as any).data, redacted: true, index: event.index } as any);
                        stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
                    } else if (event.content_block.type === "tool_use") {
                        output.content.push({ type: "toolCall", id: event.content_block.id, name: event.content_block.name, arguments: {}, partialJson: "", index: event.index } as any);
                        stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
                    }
                } else if (event.type === "content_block_delta") {
                    const index = blocks.findIndex((b) => b.index === event.index);
                    const block = blocks[index];
                    if (!block) continue;

                    if (event.delta.type === "text_delta" && block.type === "text") {
                        block.text += event.delta.text;
                        stream.push({ type: "text_delta", contentIndex: index, delta: event.delta.text, partial: output });
                    } else if (event.delta.type === "thinking_delta" && block.type === "thinking") {
                        block.thinking += event.delta.thinking;
                        stream.push({ type: "thinking_delta", contentIndex: index, delta: event.delta.thinking, partial: output });
                    } else if (event.delta.type === "input_json_delta" && block.type === "toolCall") {
                        (block as any).partialJson += event.delta.partial_json;
                        try { block.arguments = JSON.parse((block as any).partialJson); } catch { /* partial */ }
                        stream.push({ type: "toolcall_delta", contentIndex: index, delta: event.delta.partial_json, partial: output });
                    } else if (event.delta.type === "signature_delta" && block.type === "thinking") {
                        block.thinkingSignature = (block.thinkingSignature || "") + (event.delta as any).signature;
                    }
                } else if (event.type === "content_block_stop") {
                    const index = blocks.findIndex((b) => b.index === event.index);
                    const block = blocks[index];
                    if (!block) continue;
                    delete (block as any).index;

                    if (block.type === "text") stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
                    else if (block.type === "thinking") stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
                    else if (block.type === "toolCall") {
                        try { block.arguments = JSON.parse((block as any).partialJson); } catch { /* use last */ }
                        delete (block as any).partialJson;
                        stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
                    }
                } else if (event.type === "message_delta") {
                    if ((event.delta as any).stop_reason) output.stopReason = mapStopReason((event.delta as any).stop_reason);
                    if ((event.usage as any).input_tokens != null) output.usage.input = (event.usage as any).input_tokens;
                    if ((event.usage as any).output_tokens != null) output.usage.output = (event.usage as any).output_tokens;
                    if ((event.usage as any).cache_read_input_tokens != null) output.usage.cacheRead = (event.usage as any).cache_read_input_tokens;
                    if ((event.usage as any).cache_creation_input_tokens != null) output.usage.cacheWrite = (event.usage as any).cache_creation_input_tokens;
                    output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
                    calculateCost(model, output.usage);
                }
            }

            if (options?.signal?.aborted) throw new Error("Request was aborted");

            stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
            stream.end();
        } catch (error) {
            for (const block of output.content) delete (block as any).index;
            output.stopReason = options?.signal?.aborted ? "aborted" : "error";
            output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            stream.push({ type: "error", reason: output.stopReason, error: output });
            stream.end();
        }
    })();

    return stream;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
    const providerConfig = {
        baseUrl: "https://api.anthropic.com",
        apiKey: "ANTHROPIC_CONSOLE_API_KEY",
        api: "anthropic-messages" as const,
        models: FALLBACK_MODELS,
        oauth: {
            name: "Anthropic Console account \u00b7 API usage billing",
            usesCallbackServer: true,
            login,
            refreshToken,
            getApiKey: (cred: { access: string }) => cred.access,
        },
        streamSimple: streamConsole,
    };

    pi.registerProvider("anthropic-console", providerConfig);
    registerHooks(pi, providerConfig);
}
