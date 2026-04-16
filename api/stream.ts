import Anthropic from "@anthropic-ai/sdk";
import {
    type Api,
    type AssistantMessage,
    type AssistantMessageEventStream,
    type Context,
    type Model,
    type SimpleStreamOptions,
    type TextContent,
    type ThinkingContent,
    type ToolCall,
    calculateCost,
    createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";
import { convertMessages, convertTools } from "./convert.js";
import { mapReasoningToEffort, mapStopReason, sanitizeSurrogates, supportsAdaptiveThinking } from "./utils.js";

export function streamConsole(
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
