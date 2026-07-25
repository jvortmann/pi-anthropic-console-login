import { expect, test } from "bun:test";
import { FALLBACK_MODELS } from "./fallback.js";
import type { AnthropicModelInfo } from "./types.js";
import { refreshConsoleModels } from "./refresh.js";

function model(id: string, displayName: string): AnthropicModelInfo {
    return { id, display_name: displayName, created_at: "2025-01-01T00:00:00Z", type: "model" };
}

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
