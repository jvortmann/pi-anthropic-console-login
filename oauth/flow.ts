import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { startCallbackServer } from "./callback-server.js";
import { AUTHORIZE_URL, CLIENT_ID, LOCAL_REDIRECT_URI, MANUAL_REDIRECT_URI, SCOPES, TOKEN_URL } from "./constants.js";
import { parseAuthorizationInput } from "./parse.js";
import { generatePKCE } from "./pkce.js";
import { fetchWithRetry } from "./request.js";
import { createApiKey, exchangeCode } from "./tokens.js";

export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const { verifier, challenge } = await generatePKCE();

    let server: Awaited<ReturnType<typeof startCallbackServer>> | null = null;
    let redirectUri = MANUAL_REDIRECT_URI;

    try {
        server = await startCallbackServer(verifier);
        redirectUri = LOCAL_REDIRECT_URI;
    } catch {
        // Port busy — fall back to manual paste flow
    }

    const authParams = new URLSearchParams({
        code: "true",
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: verifier,
    });

    callbacks.onAuth({
        url: `${AUTHORIZE_URL}?${authParams.toString()}`,
        instructions: server
            ? "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here."
            : undefined,
    });

    let code: string | undefined;
    let state: string | undefined;
    let usedRedirectUri = redirectUri;

    if (server) {
        let manualInput: string | undefined;
        let manualError: Error | undefined;

        const manualPromise = callbacks.onManualCodeInput
            ? callbacks.onManualCodeInput()
                .then((input) => { manualInput = input; server!.cancelWait(); })
                .catch((err) => { manualError = err instanceof Error ? err : new Error(String(err)); server!.cancelWait(); })
            : null;

        const result = await server.waitForCode();
        if (manualError) throw manualError;

        if (result?.code) {
            code = result.code;
            state = result.state;
            usedRedirectUri = LOCAL_REDIRECT_URI;
        } else if (manualInput) {
            const parsed = parseAuthorizationInput(manualInput);
            if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
            code = parsed.code;
            state = parsed.state ?? verifier;
            usedRedirectUri = MANUAL_REDIRECT_URI;
        }

        if (!code && manualPromise) {
            await manualPromise;
            if (manualError) throw manualError;
            if (manualInput) {
                const parsed = parseAuthorizationInput(manualInput);
                if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
                code = parsed.code;
                state = parsed.state ?? verifier;
                usedRedirectUri = MANUAL_REDIRECT_URI;
            }
        }
    }

    if (!code) {
        const input = await callbacks.onPrompt({
            message: "Paste the authorization code or full redirect URL:",
            placeholder: MANUAL_REDIRECT_URI,
        });
        const parsed = parseAuthorizationInput(input);
        if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
        code = parsed.code;
        state = parsed.state ?? verifier;
        usedRedirectUri = MANUAL_REDIRECT_URI;
    }

    if (!code) throw new Error("Missing authorization code");
    if (!state) state = verifier;

    callbacks.onProgress?.("Exchanging authorization code for tokens...");

    let oauthCredentials: OAuthCredentials;
    try {
        oauthCredentials = await exchangeCode(code, state, verifier, usedRedirectUri);
    } finally {
        server?.server.close();
    }

    callbacks.onProgress?.("Creating API key...");
    const apiKey = await createApiKey(oauthCredentials.access);

    return {
        refresh: oauthCredentials.refresh,
        access: apiKey,
        expires: oauthCredentials.expires,
    };
}

export async function refreshToken(credentials: OAuthCredentials, signal?: AbortSignal): Promise<OAuthCredentials> {
    signal?.throwIfAborted();

    const response = await fetchWithRetry(
        TOKEN_URL,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grant_type: "refresh_token",
                client_id: CLIENT_ID,
                refresh_token: credentials.refresh,
            }),
        },
        { signal },
    );

    if (!response.ok) {
        throw new Error(`Token refresh failed: ${await response.text()}`);
    }

    const data = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
    };

    const apiKey = await createApiKey(data.access_token, signal);

    return {
        refresh: data.refresh_token,
        access: apiKey,
        expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    };
}
