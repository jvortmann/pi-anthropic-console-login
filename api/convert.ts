import type {
    ImageContent,
    Message,
    TextContent,
    ThinkingContent,
    Tool,
    ToolResultMessage,
} from "@mariozechner/pi-ai";
import { sanitizeSurrogates } from "./utils.js";

export function convertContentBlocks(content: (TextContent | ImageContent)[]): string | any[] {
    const hasImages = content.some((c) => c.type === "image");
    if (!hasImages) return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));

    const blocks = content.map((block) => {
        if (block.type === "text") return { type: "text" as const, text: sanitizeSurrogates(block.text) };
        return { type: "image" as const, source: { type: "base64" as const, media_type: block.mimeType, data: block.data } };
    });
    if (!blocks.some((b) => b.type === "text")) blocks.unshift({ type: "text" as const, text: "(see attached image)" });
    return blocks;
}

export function convertMessages(messages: Message[]): any[] {
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

export function convertTools(tools: Tool[]): any[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: { type: "object", properties: (tool.parameters as any).properties || {}, required: (tool.parameters as any).required || [] },
    }));
}
