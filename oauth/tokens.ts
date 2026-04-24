import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { API_KEY_URL, CLIENT_ID, TOKEN_URL } from "./constants.js";

export async function exchangeCode(
    code: string,
    state: string,
    verifier: string,
    redirectUri: string,
): Promise<OAuthCredentials> {
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            code,
            state,
            redirect_uri: redirectUri,
            code_verifier: verifier,
        }),
    });

    if (!response.ok) {
        throw new Error(`Token exchange failed: ${await response.text()}`);
    }

    const data = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
    };

    return {
        refresh: data.refresh_token,
        access: data.access_token,
        expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    };
}

export async function createApiKey(oauthAccessToken: string): Promise<string> {
    const response = await fetch(API_KEY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${oauthAccessToken}` },
    });

    if (!response.ok) {
        throw new Error(`API key creation failed: ${await response.text()}`);
    }

    const { raw_key } = (await response.json()) as { raw_key: string };
    if (!raw_key) throw new Error("API key creation returned no key");
    return raw_key;
}

