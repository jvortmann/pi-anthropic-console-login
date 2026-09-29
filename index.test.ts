import { afterEach, expect, mock, test } from "bun:test";

// pi supplies these modules to the extension at load time.
const hostCatalog = new Map<string, Record<string, unknown>>([
    [
        "claude-fable-5",
        {
            id: "claude-fable-5",
            cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
        },
    ],
]);
mock.module("@earendil-works/pi-coding-agent", () => ({ VERSION: "0.99.1" }));
mock.module("@earendil-works/pi-ai", () => ({ streamSimple: () => undefined }));
mock.module("@earendil-works/pi-ai/providers/all", () => ({
    getBuiltinModel: (provider: string, modelId: string) =>
        provider === "anthropic" ? hostCatalog.get(modelId) : undefined,
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

async function refreshWithConsoleModels(ids: string[]) {
    globalThis.fetch = (async () =>
        Response.json({
            data: ids.map((id) => ({ id, display_name: id, created_at: "", type: "model" })),
            has_more: false,
        })) as unknown as typeof fetch;

    let provider: any;
    const { default: extension } = await import("./index.js");
    extension({ registerProvider: (_id: string, config: unknown) => (provider = config) } as any);

    return provider.refreshModels({
        credential: { type: "api_key", key: "sk-ant-test" },
        allowNetwork: true,
        signal: new AbortController().signal,
    });
}

test("prices a refreshed console model from pi's built-in anthropic catalog", async () => {
    const models = await refreshWithConsoleModels(["claude-fable-5"]);

    expect(models.find((m: { id: string }) => m.id === "claude-fable-5")?.cost).toEqual({
        input: 10,
        output: 50,
        cacheRead: 1,
        cacheWrite: 12.5,
    });
});
