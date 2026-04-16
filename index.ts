/**
 * Anthropic Console OAuth Provider
 *
 * Adds "Anthropic Console account" as a login option in pi,
 * authenticating against the Console (organization/API billing)
 * instead of the personal claude.ai subscription.
 *
 * Usage:
 *   1. Install deps: cd ~/.config/pi/extensions/anthropic-console && npm install
 *   2. Restart pi (or /reload)
 *   3. /login → select "Anthropic Console account · API usage billing"
 *   4. /model → select an anthropic-console model
 */

import type { Server } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import {
    type Api,
    type AssistantMessage,
    type AssistantMessageEventStream,
    type Context,
    type ImageContent,
    type Message,
    type Model,
    type OAuthCredentials,
    type OAuthLoginCallbacks,
    type SimpleStreamOptions,
    type TextContent,
    type ThinkingContent,
    type Tool,
    type ToolCall,
    type ToolResultMessage,
    calculateCost,
    createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// =============================================================================
// OAuth — Anthropic Console (organization account, API usage billing)
// =============================================================================

const decode = (s: string) => atob(s);
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://platform.claude.com/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const API_KEY_URL = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key";
const MANUAL_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile";

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 53693;
const CALLBACK_PATH = "/callback";
const LOCAL_REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const verifier = btoa(String.fromCharCode(...array))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    return { verifier, challenge };
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
    const value = input.trim();
    if (!value) return {};

    try {
        const url = new URL(value);
        return {
            code: url.searchParams.get("code") ?? undefined,
            state: url.searchParams.get("state") ?? undefined,
        };
    } catch { /* not a URL */ }

    if (value.includes("#")) {
        const [code, state] = value.split("#", 2);
        return { code, state };
    }

    if (value.includes("code=")) {
        const params = new URLSearchParams(value);
        return {
            code: params.get("code") ?? undefined,
            state: params.get("state") ?? undefined,
        };
    }

    return { code: value };
}

const SUCCESS_HTML = `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
<div style="text-align:center"><h2 style="color:#4ecca3">\u2713 Authentication complete</h2><p>You can close this window and return to pi.</p></div></body></html>`;

const ERROR_HTML = (msg: string) =>
    `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
<div style="text-align:center"><h2 style="color:#e74c3c">\u2717 Authentication failed</h2><p>${msg}</p></div></body></html>`;

async function startCallbackServer(expectedState: string): Promise<{
    server: Server;
    waitForCode: () => Promise<{ code: string; state: string } | null>;
    cancelWait: () => void;
}> {
    const { createServer } = await import("node:http");
    return new Promise((resolve, reject) => {
        let settleWait: ((value: { code: string; state: string } | null) => void) | undefined;

        const waitForCodePromise = new Promise<{ code: string; state: string } | null>((resolveWait) => {
            let settled = false;
            settleWait = (value) => {
                if (settled) return;
                settled = true;
                resolveWait(value);
            };
        });

        const server = createServer((req, res) => {
            try {
                const url = new URL(req.url || "", "http://localhost");
                if (url.pathname !== CALLBACK_PATH) {
                    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(ERROR_HTML("Callback route not found."));
                    return;
                }

                const code = url.searchParams.get("code");
                const state = url.searchParams.get("state");
                const error = url.searchParams.get("error");

                if (error) {
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(ERROR_HTML(`Error: ${error}`));
                    return;
                }

                if (!code || !state) {
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(ERROR_HTML("Missing code or state parameter."));
                    return;
                }

                if (state !== expectedState) {
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(ERROR_HTML("State mismatch."));
                    return;
                }

                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(SUCCESS_HTML);
                settleWait?.({ code, state });
            } catch {
                res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("Internal error");
            }
        });

        server.on("error", reject);
        server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
            resolve({
                server,
                cancelWait: () => settleWait?.(null),
                waitForCode: () => waitForCodePromise,
            });
        });
    });
}

async function exchangeCode(
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

async function createApiKey(oauthAccessToken: string): Promise<string> {
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

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
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

async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: CLIENT_ID,
            refresh_token: credentials.refresh,
        }),
    });

    if (!response.ok) {
        throw new Error(`Token refresh failed: ${await response.text()}`);
    }

    const data = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
    };

    const apiKey = await createApiKey(data.access_token);

    return {
        refresh: data.refresh_token,
        access: apiKey,
        expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    };
}

// =============================================================================
// Dynamic Model Discovery
// =============================================================================

interface AnthropicModelInfo {
    id: string;
    display_name: string;
    created_at: string;
    type: "model";
}

interface AnthropicModelListResponse {
    data: AnthropicModelInfo[];
    has_more: boolean;
    first_id: string | null;
    last_id: string | null;
}

async function fetchModels(apiKey: string): Promise<AnthropicModelInfo[] | null> {
    try {
        const allModels: AnthropicModelInfo[] = [];
        let afterId: string | undefined;

        do {
            const url = new URL("https://api.anthropic.com/v1/models");
            url.searchParams.set("limit", "100");
            if (afterId) url.searchParams.set("after_id", afterId);

            const response = await fetch(url.toString(), {
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                },
            });

            if (!response.ok) return null;

            const page = (await response.json()) as AnthropicModelListResponse;
            allModels.push(...page.data);

            if (page.has_more && page.last_id) {
                afterId = page.last_id;
            } else {
                break;
            }
        } while (true);

        return allModels;
    } catch {
        return null;
    }
}

// =============================================================================
// Streaming — Minimal Anthropic API streaming using the SDK directly
// =============================================================================

function sanitizeSurrogates(text: string): string {
    return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

function supportsAdaptiveThinking(modelId: string): boolean {
    return modelId.includes("opus-4-6") || modelId.includes("opus-4.6")
        || modelId.includes("opus-4-7") || modelId.includes("opus-4.7")
        || modelId.includes("sonnet-4-6") || modelId.includes("sonnet-4.6");
}

type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

function isOpus47OrLater(modelId: string): boolean {
    const match = modelId.match(/opus-?(\d+)[-.](\d+)/);
    if (!match) return false;
    const [, major, minor] = match;
    return Number(major) > 4 || (Number(major) === 4 && Number(minor) >= 7);
}

function mapReasoningToEffort(level: SimpleStreamOptions["reasoning"], modelId: string): AnthropicEffort {
    const isOpus = modelId.includes("opus");
    switch (level) {
        case "minimal": case "low": return "low";
        case "medium": return "medium";
        case "high": return "high";
        case "xhigh": return isOpus47OrLater(modelId) ? "xhigh" : isOpus ? "max" : "high";
        default: return "high";
    }
}

function convertContentBlocks(content: (TextContent | ImageContent)[]): string | any[] {
    const hasImages = content.some((c) => c.type === "image");
    if (!hasImages) return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));

    const blocks = content.map((block) => {
        if (block.type === "text") return { type: "text" as const, text: sanitizeSurrogates(block.text) };
        return { type: "image" as const, source: { type: "base64" as const, media_type: block.mimeType, data: block.data } };
    });
    if (!blocks.some((b) => b.type === "text")) blocks.unshift({ type: "text" as const, text: "(see attached image)" });
    return blocks;
}

function convertMessages(messages: Message[]): any[] {
    const params: any[] = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (msg.role === "user") {
            if (typeof msg.content === "string") {
                if (msg.content.trim()) params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
            } else {
                const blocks = msg.content.map((item) =>
                    item.type === "text"
                        ? { type: "text" as const, text: sanitizeSurrogates(item.text) }
                        : { type: "image" as const, source: { type: "base64" as const, media_type: item.mimeType as any, data: item.data } }
                );
                if (blocks.length > 0) params.push({ role: "user", content: blocks });
            }
        } else if (msg.role === "assistant") {
            const blocks: any[] = [];
            for (const block of msg.content) {
                if (block.type === "text" && block.text.trim()) {
                    blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
                } else if (block.type === "thinking" && block.thinking.trim()) {
                    if ((block as ThinkingContent).redacted) {
                        blocks.push({ type: "redacted_thinking", data: (block as ThinkingContent).thinkingSignature });
                    } else if ((block as ThinkingContent).thinkingSignature) {
                        blocks.push({ type: "thinking", thinking: sanitizeSurrogates(block.thinking), signature: (block as ThinkingContent).thinkingSignature });
                    } else {
                        blocks.push({ type: "text", text: sanitizeSurrogates(block.thinking) });
                    }
                } else if (block.type === "toolCall") {
                    blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.arguments });
                }
            }
            if (blocks.length > 0) params.push({ role: "assistant", content: blocks });
        } else if (msg.role === "toolResult") {
            const toolResults: any[] = [{ type: "tool_result", tool_use_id: msg.toolCallId, content: convertContentBlocks(msg.content), is_error: msg.isError }];
            let j = i + 1;
            while (j < messages.length && messages[j].role === "toolResult") {
                const next = messages[j] as ToolResultMessage;
                toolResults.push({ type: "tool_result", tool_use_id: next.toolCallId, content: convertContentBlocks(next.content), is_error: next.isError });
                j++;
            }
            i = j - 1;
            params.push({ role: "user", content: toolResults });
        }
    }

    // Cache control on last user message
    if (params.length > 0) {
        const last = params[params.length - 1];
        if (last.role === "user" && Array.isArray(last.content)) {
            const lastBlock = last.content[last.content.length - 1];
            if (lastBlock) lastBlock.cache_control = { type: "ephemeral" };
        }
    }

    return params;
}

function convertTools(tools: Tool[]): any[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: { type: "object", properties: (tool.parameters as any).properties || {}, required: (tool.parameters as any).required || [] },
    }));
}

function mapStopReason(reason: string): "stop" | "length" | "toolUse" | "error" {
    switch (reason) {
        case "end_turn": case "pause_turn": case "stop_sequence": return "stop";
        case "max_tokens": return "length";
        case "tool_use": return "toolUse";
        default: return "error";
    }
}

function streamConsole(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();

    (async () => {
        const output: AssistantMessage = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
        };

        try {
            const apiKey = options?.apiKey ?? "";
            const betaFeatures = ["fine-grained-tool-streaming-2025-05-14"];
            if (!supportsAdaptiveThinking(model.id)) betaFeatures.push("interleaved-thinking-2025-05-14");

            const client = new Anthropic({
                apiKey,
                baseURL: model.baseUrl,
                dangerouslyAllowBrowser: true,
                defaultHeaders: {
                    "accept": "application/json",
                    "anthropic-dangerous-direct-browser-access": "true",
                    "anthropic-beta": `claude-code-20250219,${betaFeatures.join(",")}`,
                    "user-agent": "claude-cli/2.1.85",
                    "x-app": "cli",
                },
            });

            const params: any = {
                model: model.id,
                messages: convertMessages(context.messages),
                max_tokens: options?.maxTokens || Math.floor(model.maxTokens / 3),
                stream: true,
            };

            params.system = [
                { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: "ephemeral" } },
            ];
            if (context.systemPrompt) {
                params.system.push({ type: "text", text: sanitizeSurrogates(context.systemPrompt), cache_control: { type: "ephemeral" } });
            }

            if (context.tools) params.tools = convertTools(context.tools);

            if (model.reasoning && options?.reasoning) {
                if (supportsAdaptiveThinking(model.id)) {
                    params.thinking = { type: "adaptive" };
                    params.output_config = { effort: mapReasoningToEffort(options.reasoning, model.id) };
                } else {
                    const budgets: Record<string, number> = { minimal: 1024, low: 4096, medium: 10240, high: 20480 };
                    params.thinking = { type: "enabled", budget_tokens: options.thinkingBudgets?.[options.reasoning as keyof typeof options.thinkingBudgets] ?? budgets[options.reasoning] ?? 10240 };
                }
            }

            const anthropicStream = client.messages.stream({ ...params }, { signal: options?.signal });
            stream.push({ type: "start", partial: output });

            type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
            const blocks = output.content as Block[];

            for await (const event of anthropicStream) {
                if (event.type === "message_start") {
                    output.responseId = event.message.id;
                    output.usage.input = event.message.usage.input_tokens || 0;
                    output.usage.output = event.message.usage.output_tokens || 0;
                    output.usage.cacheRead = (event.message.usage as any).cache_read_input_tokens || 0;
                    output.usage.cacheWrite = (event.message.usage as any).cache_creation_input_tokens || 0;
                    output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
                    calculateCost(model, output.usage);
                } else if (event.type === "content_block_start") {
                    if (event.content_block.type === "text") {
                        output.content.push({ type: "text", text: "", index: event.index } as any);
                        stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
                    } else if (event.content_block.type === "thinking") {
                        output.content.push({ type: "thinking", thinking: "", thinkingSignature: "", index: event.index } as any);
                        stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
                    } else if ((event.content_block as any).type === "redacted_thinking") {
                        output.content.push({ type: "thinking", thinking: "[Reasoning redacted]", thinkingSignature: (event.content_block as any).data, redacted: true, index: event.index } as any);
                        stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
                    } else if (event.content_block.type === "tool_use") {
                        output.content.push({ type: "toolCall", id: event.content_block.id, name: event.content_block.name, arguments: {}, partialJson: "", index: event.index } as any);
                        stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
                    }
                } else if (event.type === "content_block_delta") {
                    const index = blocks.findIndex((b) => b.index === event.index);
                    const block = blocks[index];
                    if (!block) continue;

                    if (event.delta.type === "text_delta" && block.type === "text") {
                        block.text += event.delta.text;
                        stream.push({ type: "text_delta", contentIndex: index, delta: event.delta.text, partial: output });
                    } else if (event.delta.type === "thinking_delta" && block.type === "thinking") {
                        block.thinking += event.delta.thinking;
                        stream.push({ type: "thinking_delta", contentIndex: index, delta: event.delta.thinking, partial: output });
                    } else if (event.delta.type === "input_json_delta" && block.type === "toolCall") {
                        (block as any).partialJson += event.delta.partial_json;
                        try { block.arguments = JSON.parse((block as any).partialJson); } catch { /* partial */ }
                        stream.push({ type: "toolcall_delta", contentIndex: index, delta: event.delta.partial_json, partial: output });
                    } else if (event.delta.type === "signature_delta" && block.type === "thinking") {
                        block.thinkingSignature = (block.thinkingSignature || "") + (event.delta as any).signature;
                    }
                } else if (event.type === "content_block_stop") {
                    const index = blocks.findIndex((b) => b.index === event.index);
                    const block = blocks[index];
                    if (!block) continue;
                    delete (block as any).index;

                    if (block.type === "text") stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
                    else if (block.type === "thinking") stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
                    else if (block.type === "toolCall") {
                        try { block.arguments = JSON.parse((block as any).partialJson); } catch { /* use last */ }
                        delete (block as any).partialJson;
                        stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
                    }
                } else if (event.type === "message_delta") {
                    if ((event.delta as any).stop_reason) output.stopReason = mapStopReason((event.delta as any).stop_reason);
                    if ((event.usage as any).input_tokens != null) output.usage.input = (event.usage as any).input_tokens;
                    if ((event.usage as any).output_tokens != null) output.usage.output = (event.usage as any).output_tokens;
                    if ((event.usage as any).cache_read_input_tokens != null) output.usage.cacheRead = (event.usage as any).cache_read_input_tokens;
                    if ((event.usage as any).cache_creation_input_tokens != null) output.usage.cacheWrite = (event.usage as any).cache_creation_input_tokens;
                    output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
                    calculateCost(model, output.usage);
                }
            }

            if (options?.signal?.aborted) throw new Error("Request was aborted");

            stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
            stream.end();
        } catch (error) {
            for (const block of output.content) delete (block as any).index;
            output.stopReason = options?.signal?.aborted ? "aborted" : "error";
            output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            stream.push({ type: "error", reason: output.stopReason, error: output });
            stream.end();
        }
    })();

    return stream;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
    pi.registerProvider("anthropic-console", {
        baseUrl: "https://api.anthropic.com",
        apiKey: "ANTHROPIC_CONSOLE_API_KEY",
        api: "anthropic-messages",

        models: [
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
        ],

        oauth: {
            name: "Anthropic Console account \u00b7 API usage billing",
            usesCallbackServer: true,
            login,
            refreshToken,
            getApiKey: (cred) => cred.access,
        },

        streamSimple: streamConsole,
    });
}
