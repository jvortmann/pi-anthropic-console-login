import { afterEach, expect, test } from "bun:test";
import { API_KEY_URL, TOKEN_URL } from "./constants.js";
import { refreshToken } from "./flow.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

let issued = 0;

/** Each test sends its own refresh token, because refreshToken remembers exchanges. */
function freshCredentials() {
    issued += 1;
    return { refresh: `refresh-token-${issued}`, access: "sk-ant-old", expires: 0 };
}

test("does not contact the token endpoint when the refresh is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    globalThis.fetch = (async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await expect(refreshToken(freshCredentials(), controller.signal)).rejects.toThrow();
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

    const result = await refreshToken(freshCredentials());

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

    const result = await refreshToken(freshCredentials(), controller.signal);

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

    await expect(refreshToken(freshCredentials())).rejects.toThrow(/invalid_grant/);
    expect(attempts).toBe(1);
});

test("keeps the new refresh token when the refresh is cancelled during api key creation", async () => {
    const sent = freshCredentials();
    const controller = new AbortController();
    let tokenRequests = 0;
    let keyRequests = 0;

    globalThis.fetch = (async (url: string) => {
        if (url === TOKEN_URL) {
            tokenRequests += 1;
            return new Response(
                JSON.stringify({
                    access_token: `oauth-access-${tokenRequests}`,
                    refresh_token: `next-refresh-${tokenRequests}`,
                    expires_in: 3600,
                }),
                { status: 200 },
            );
        }
        keyRequests += 1;
        if (keyRequests === 1) {
            controller.abort();
            throw controller.signal.reason;
        }
        return new Response(JSON.stringify({ raw_key: "sk-ant-new" }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(refreshToken(sent, controller.signal)).rejects.toThrow();
    const result = await refreshToken(sent);

    expect(tokenRequests).toBe(1);
    expect(result.refresh).toBe("next-refresh-1");
    expect(result.access).toBe("sk-ant-new");
});

test("returns the same login again when pi did not save a completed refresh", async () => {
    const sent = freshCredentials();
    let requests = 0;

    globalThis.fetch = (async (url: string) => {
        requests += 1;
        if (url === TOKEN_URL) {
            return new Response(
                JSON.stringify({ access_token: "oauth-access", refresh_token: "next-refresh", expires_in: 3600 }),
                { status: 200 },
            );
        }
        return new Response(JSON.stringify({ raw_key: `sk-ant-new-${requests}` }), { status: 200 });
    }) as unknown as typeof fetch;

    const first = await refreshToken(sent);
    const second = await refreshToken(sent);

    expect(requests).toBe(2);
    expect(second).toEqual(first);
});

test("gives up after a bounded number of connection failures", async () => {
    let attempts = 0;

    globalThis.fetch = (async () => {
        attempts += 1;
        throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(refreshToken(freshCredentials())).rejects.toThrow(/fetch failed/);
    expect(attempts).toBe(3);
});
