import { afterEach, expect, test } from "bun:test";
import { fetchModels } from "./fetch.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("sends the api key and forwards the abort signal", async () => {
    const controller = new AbortController();
    let seenHeaders: Record<string, string> | undefined;
    let seenSignal: AbortSignal | undefined;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        seenHeaders = init?.headers as Record<string, string>;
        seenSignal = init?.signal ?? undefined;
        return new Response(JSON.stringify({ data: [], has_more: false, last_id: null }), { status: 200 });
    }) as typeof fetch;

    await fetchModels("sk-ant-key", controller.signal);

    expect(seenHeaders?.["x-api-key"]).toBe("sk-ant-key");
    expect(seenSignal).toBe(controller.signal);
});
