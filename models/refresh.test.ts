import { expect, test } from "bun:test";
import { FALLBACK_MODELS } from "./fallback.js";
import type { AnthropicModelInfo } from "./types.js";
import { refreshConsoleModels } from "./refresh.js";

function model(id: string, displayName: string): AnthropicModelInfo {
    return { id, display_name: displayName, created_at: "2025-01-01T00:00:00Z", type: "model" };
}

function storedModel(id: string, name: string) {
    return {
        id,
        name,
        api: "anthropic-console-api",
        provider: "anthropic-console",
        baseUrl: "https://api.anthropic.com",
        reasoning: true,
        input: ["text", "image"] as ("text" | "image")[],
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        contextWindow: 1000000,
        maxTokens: 128000,
    };
}

interface StoredEntry {
    models: readonly Record<string, unknown>[];
    checkedAt?: number;
}

function fakePublish() {
    const published: { persist?: StoredEntry | null }[] = [];
    return {
        publish: async (publication: { persist?: StoredEntry | null }) => {
            published.push(publication);
            return true;
        },
        published,
    };
}

test("keeps the stored catalog when the network is not allowed", async () => {
    const result = await refreshConsoleModels(
        {
            credential: { type: "oauth", access: "sk-ant-key" },
            allowNetwork: false,
            stored: { models: [storedModel("claude-opus-5", "Claude Opus 5 (console)")] },
            publish: fakePublish().publish,
        },
        async () => {
            throw new Error("should not fetch without network access");
        },
    );

    expect(result.map((m) => m.id)).toEqual(["claude-opus-5"]);
});

test("persists a successful live fetch for later sessions", async () => {
    const publisher = fakePublish();

    await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: true, publish: publisher.publish },
        async () => [model("claude-opus-5", "Claude Opus 5")],
    );

    const entry = publisher.published[0]?.persist;
    expect(entry?.models.map((m) => m.id)).toEqual(["claude-opus-5"]);
    expect(entry?.models[0].provider).toBe("anthropic-console");
    expect(entry?.models[0].api).toBe("anthropic-console-api");
    expect(entry?.models[0].baseUrl).toBe("https://api.anthropic.com");
    expect(typeof entry?.checkedAt).toBe("number");
});

test("applies the host catalog entry to the published catalog", async () => {
    const publisher = fakePublish();

    const result = await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: true, publish: publisher.publish },
        async () => [model("claude-fable-5", "Claude Fable 5")],
        () => ({
            cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
            compat: { forceAdaptiveThinking: true },
            thinkingLevelMap: { xhigh: "xhigh" },
        }),
    );

    expect(result[0].cost).toEqual({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 });
    expect(result[0].compat).toEqual({ forceAdaptiveThinking: true });
    expect(result[0].thinkingLevelMap).toEqual({ xhigh: "xhigh" });
    expect(publisher.published[0]?.persist?.models[0].cost).toEqual({
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
    });
});

test("maps a live fetch using the OAuth access token", async () => {
    let usedKey: string | undefined;
    const result = await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: true, publish: fakePublish().publish },
        async (apiKey) => {
            usedKey = apiKey;
            return [model("claude-sonnet-4-6", "Claude Sonnet 4.6")];
        },
    );

    expect(usedKey).toBe("sk-ant-key");
    expect(result.map((m) => m.id)).toEqual(["claude-sonnet-4-6"]);
    expect(result[0].name).toBe("Claude Sonnet 4.6 (console)");
});

test("falls back to the built-in catalog when there is no credential", async () => {
    const result = await refreshConsoleModels({ allowNetwork: true, publish: fakePublish().publish }, async () => {
        throw new Error("should not fetch without a credential");
    });
    expect(result).toEqual(FALLBACK_MODELS);
});

test("does not hit the network when network access is disabled", async () => {
    let fetched = false;
    const result = await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: false, publish: fakePublish().publish },
        async () => {
            fetched = true;
            return [model("claude-sonnet-4-6", "Claude Sonnet 4.6")];
        },
    );
    expect(fetched).toBe(false);
    expect(result).toEqual(FALLBACK_MODELS);
});

test("falls back to the built-in catalog when the fetch fails", async () => {
    const result = await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: true, publish: fakePublish().publish },
        async () => null,
    );
    expect(result).toEqual(FALLBACK_MODELS);
});

test("keeps the stored catalog when the fetch fails", async () => {
    const publisher = fakePublish();

    const result = await refreshConsoleModels(
        {
            credential: { type: "oauth", access: "sk-ant-key" },
            allowNetwork: true,
            stored: { models: [storedModel("claude-opus-5", "Claude Opus 5 (console)")] },
            publish: publisher.publish,
        },
        async () => null,
    );

    expect(result.map((m) => m.id)).toEqual(["claude-opus-5"]);
    expect(publisher.published.length).toBe(0);
});

test("keeps the stored catalog when there is no credential", async () => {
    const result = await refreshConsoleModels(
        {
            allowNetwork: true,
            stored: { models: [storedModel("claude-opus-5", "Claude Opus 5 (console)")] },
            publish: fakePublish().publish,
        },
        async () => {
            throw new Error("should not fetch without a credential");
        },
    );

    expect(result.map((m) => m.id)).toEqual(["claude-opus-5"]);
});

test("falls back to the built-in catalog when the stored catalog is empty", async () => {
    const result = await refreshConsoleModels(
        { allowNetwork: false, stored: { models: [] }, publish: fakePublish().publish },
        async () => null,
    );

    expect(result).toEqual(FALLBACK_MODELS);
});

test("uses the stored api-key credential when present", async () => {
    let usedKey: string | undefined;
    await refreshConsoleModels(
        { credential: { type: "api_key", key: "env-key" }, allowNetwork: true, publish: fakePublish().publish },
        async (apiKey) => {
            usedKey = apiKey;
            return [model("claude-haiku-4-5-20251001", "Claude Haiku 4.5")];
        },
    );
    expect(usedKey).toBe("env-key");
});
