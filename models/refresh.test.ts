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

function fakeStore(initial?: StoredEntry) {
    let entry: StoredEntry | undefined = initial;
    return {
        read: async () => entry as never,
        write: async (next: StoredEntry) => {
            entry = next;
        },
        current: () => entry,
    };
}

test("keeps the stored catalog when the network is not allowed", async () => {
    const store = fakeStore({ models: [storedModel("claude-opus-5", "Claude Opus 5 (console)")] });

    const result = await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: false, store },
        async () => {
            throw new Error("should not fetch without network access");
        },
    );

    expect(result.map((m) => m.id)).toEqual(["claude-opus-5"]);
});

test("persists a successful live fetch for later sessions", async () => {
    const store = fakeStore();

    await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: true, store },
        async () => [model("claude-opus-5", "Claude Opus 5")],
    );

    const entry = store.current();
    expect(entry?.models.map((m) => m.id)).toEqual(["claude-opus-5"]);
    expect(entry?.models[0].provider).toBe("anthropic-console");
    expect(entry?.models[0].api).toBe("anthropic-console-api");
    expect(entry?.models[0].baseUrl).toBe("https://api.anthropic.com");
    expect(typeof entry?.checkedAt).toBe("number");
});

test("maps a live fetch using the OAuth access token", async () => {
    let usedKey: string | undefined;
    const result = await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: true },
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
    const result = await refreshConsoleModels({ allowNetwork: true }, async () => {
        throw new Error("should not fetch without a credential");
    });
    expect(result).toEqual(FALLBACK_MODELS);
});

test("does not hit the network when network access is disabled", async () => {
    let fetched = false;
    const result = await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: false },
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
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: true },
        async () => null,
    );
    expect(result).toEqual(FALLBACK_MODELS);
});

test("keeps the stored catalog when the fetch fails", async () => {
    const store = fakeStore({ models: [storedModel("claude-opus-5", "Claude Opus 5 (console)")] });

    const result = await refreshConsoleModels(
        { credential: { type: "oauth", access: "sk-ant-key" }, allowNetwork: true, store },
        async () => null,
    );

    expect(result.map((m) => m.id)).toEqual(["claude-opus-5"]);
});

test("keeps the stored catalog when there is no credential", async () => {
    const store = fakeStore({ models: [storedModel("claude-opus-5", "Claude Opus 5 (console)")] });

    const result = await refreshConsoleModels({ allowNetwork: true, store }, async () => {
        throw new Error("should not fetch without a credential");
    });

    expect(result.map((m) => m.id)).toEqual(["claude-opus-5"]);
});

test("falls back to the built-in catalog when the store is empty", async () => {
    const store = fakeStore({ models: [] });

    const result = await refreshConsoleModels({ allowNetwork: false, store }, async () => null);

    expect(result).toEqual(FALLBACK_MODELS);
});

test("uses the stored api-key credential when present", async () => {
    let usedKey: string | undefined;
    await refreshConsoleModels(
        { credential: { type: "api_key", key: "env-key" }, allowNetwork: true },
        async (apiKey) => {
            usedKey = apiKey;
            return [model("claude-haiku-4-5-20251001", "Claude Haiku 4.5")];
        },
    );
    expect(usedKey).toBe("env-key");
});
