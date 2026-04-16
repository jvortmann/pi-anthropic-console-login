import type { SimpleStreamOptions } from "@mariozechner/pi-ai";

export function sanitizeSurrogates(text: string): string {
    return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

export function supportsAdaptiveThinking(modelId: string): boolean {
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

export function mapReasoningToEffort(level: SimpleStreamOptions["reasoning"], modelId: string): AnthropicEffort {
    const isOpus = modelId.includes("opus");
    switch (level) {
        case "minimal": case "low": return "low";
        case "medium": return "medium";
        case "high": return "high";
        case "xhigh": return isOpus47OrLater(modelId) ? "xhigh" : isOpus ? "max" : "high";
        default: return "high";
    }
}

export function mapStopReason(reason: string): "stop" | "length" | "toolUse" | "error" {
    switch (reason) {
        case "end_turn": case "pause_turn": case "stop_sequence": return "stop";
        case "max_tokens": return "length";
        case "tool_use": return "toolUse";
        default: return "error";
    }
}
