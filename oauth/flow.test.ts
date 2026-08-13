import { afterEach, expect, test } from "bun:test";
import { API_KEY_URL, TOKEN_URL } from "./constants.js";
import { refreshToken } from "./flow.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

const credentials = { refresh: "refresh-token", access: "sk-ant-old", expires: 0 };

test("does not contact the token endpoint when the refresh is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    globalThis.fetch = (async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await expect(refreshToken(credentials, controller.signal)).rejects.toThrow();
    expect(calls).toBe(0);
});

test("retries the token request after a transient connection failure", async () => {
    let attempts = 0;

    globalThis.fetch = (async (url: string) => {
        if (url === TOKEN_URL) {
            attempts += 1;
            if (attempts === 1) throw new TypeError("fetch failed");
            return new Response(
                JSON.stringify({ access_token: "oauth-access", refresh_token: "next-refresh", expires_in: 3600 }),
                { status: 200 },
            );
        }
        return new Response(JSON.stringify({ raw_key: "sk-ant-new" }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await refreshToken(credentials);

    expect(attempts).toBe(2);
    expect(result.refresh).toBe("next-refresh");
    expect(result.access).toBe("sk-ant-new");
});

test("retries the api key request after a transient connection failure", async () => {
    let attempts = 0;
    let seenSignal: AbortSignal | undefined;
    const controller = new AbortController();

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        if (url === TOKEN_URL) {
            return new Response(
                JSON.stringify({ access_token: "oauth-access", refresh_token: "next-refresh", expires_in: 3600 }),
                { status: 200 },
            );
        }
        expect(url).toBe(API_KEY_URL);
        attempts += 1;
        seenSignal = init?.signal ?? undefined;
        if (attempts === 1) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ raw_key: "sk-ant-new" }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await refreshToken(credentials, controller.signal);

    expect(attempts).toBe(2);
    expect(seenSignal).toBe(controller.signal);
    expect(result.access).toBe("sk-ant-new");
});

test("surfaces a rejected refresh token without retrying it", async () => {
    let attempts = 0;

    globalThis.fetch = (async () => {
        attempts += 1;
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(refreshToken(credentials)).rejects.toThrow(/invalid_grant/);
    expect(attempts).toBe(1);
});

test("gives up after a bounded number of connection failures", async () => {
    let attempts = 0;

    globalThis.fetch = (async () => {
        attempts += 1;
        throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(refreshToken(credentials)).rejects.toThrow(/fetch failed/);
    expect(attempts).toBe(3);
});
