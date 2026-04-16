import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

export const FALLBACK_MODELS: ProviderModelConfig[] = [
    {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7 (console)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        contextWindow: 1000000,
        maxTokens: 128000,
    },
    {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6 (console)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        contextWindow: 1000000,
        maxTokens: 128000,
    },
    {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6 (console)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 1000000,
        maxTokens: 64000,
    },
    {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5 (console)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
        contextWindow: 200000,
        maxTokens: 64000,
    },
];
