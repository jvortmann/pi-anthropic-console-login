import { expect, test } from "bun:test";
import { mapApiModelsToProviderConfigs } from "./map.js";
import type { AnthropicModelInfo } from "./types.js";

function apiModel(id: string, extra: Partial<AnthropicModelInfo> = {}): AnthropicModelInfo {
    return {
        id,
        display_name: id,
        created_at: "2026-01-01T00:00:00Z",
        type: "model",
        ...extra,
    };
}

test("takes the context window from the advertised input limit", () => {
    const [mapped] = mapApiModelsToProviderConfigs([
        apiModel("claude-fable-5", { max_input_tokens: 1000000 }),
    ]);

    expect(mapped.contextWindow).toBe(1000000);
});

test("takes the output limit from the advertised max tokens", () => {
    const [mapped] = mapApiModelsToProviderConfigs([
        apiModel("claude-sonnet-4-6", { max_input_tokens: 1000000, max_tokens: 128000 }),
    ]);

    expect(mapped.maxTokens).toBe(128000);
});

test("accepts image input only when the model advertises it", () => {
    const [withImages, withoutImages] = mapApiModelsToProviderConfigs([
        apiModel("claude-opus-5", { capabilities: { image_input: { supported: true } } }),
        apiModel("claude-haiku-4-5-20251001", { capabilities: { image_input: { supported: false } } }),
    ]);

    expect(withImages.input).toEqual(["text", "image"]);
    expect(withoutImages.input).toEqual(["text"]);
});

test("marks reasoning only when the model advertises thinking", () => {
    const [thinker, nonThinker] = mapApiModelsToProviderConfigs([
        apiModel("claude-opus-5", { capabilities: { thinking: { supported: true } } }),
        apiModel("claude-legacy-4-6", { capabilities: { thinking: { supported: false } } }),
    ]);

    expect(thinker.reasoning).toBe(true);
    expect(nonThinker.reasoning).toBe(false);
});

test("falls back to the known traits when the response carries no metadata", () => {
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-haiku-4-5-20251001")]);

    expect(mapped.contextWindow).toBe(200000);
    expect(mapped.maxTokens).toBe(64000);
    expect(mapped.input).toEqual(["text", "image"]);
    expect(mapped.reasoning).toBe(true);
});

test("carries the host catalog's compatibility settings onto the console model", () => {
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-opus-5")], () => ({
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        compat: { forceAdaptiveThinking: true, supportsTemperature: false },
    }));

    expect(mapped.compat).toEqual({ forceAdaptiveThinking: true, supportsTemperature: false });
});

test("prices a server-side fallback reply under the console provider", () => {
    const cost = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-fable-5")], () => ({
        compat: {
            forceAdaptiveThinking: true,
            allowedFallbackModels: [{ provider: "anthropic", model: "claude-opus-5", cost }],
        },
    }));

    expect(mapped.compat).toEqual({
        forceAdaptiveThinking: true,
        allowedFallbackModels: [{ provider: "anthropic-console", model: "claude-opus-5", cost }],
    });
});

test("carries the host catalog's thinking levels onto the console model", () => {
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-opus-5")], () => ({
        thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    }));

    expect(mapped.thinkingLevelMap).toEqual({ xhigh: "xhigh", max: "max" });
});

test("keeps the prompt cache warm for as long as the host catalog allows", () => {
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-opus-5")], () => ({
        promptCache: { short: 300, long: 3600 },
    }));

    expect(mapped.promptCache).toEqual({ short: 300, long: 3600 });
});

test("limits requests and images the way the host catalog does", () => {
    const inputLimits = {
        maxRequestBytes: 33554432,
        images: { maxPerRequest: 600, resize: { maxWidth: 2000, maxHeight: 2000 } },
    };
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-opus-5")], () => ({ inputLimits }));

    expect(mapped.inputLimits).toEqual(inputLimits);
});

test("prices a model from the host catalog when it knows that model", () => {
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-fable-5")], () => ({
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    }));

    expect(mapped.cost).toEqual({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 });
});

test("keeps the known traits price when the host catalog does not know the model", () => {
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-haiku-4-5-20251001")], () => undefined);

    expect(mapped.cost).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
});

test("leaves request shaping unset when the host catalog does not know the model", () => {
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-unknown-9")], () => undefined);

    expect(mapped.compat).toBe(undefined);
    expect(mapped.thinkingLevelMap).toBe(undefined);
});

test("still registers the model when the host catalog lookup fails", () => {
    const [mapped] = mapApiModelsToProviderConfigs([apiModel("claude-haiku-4-5-20251001")], () => {
        throw new Error("registry unavailable");
    });

    expect(mapped.id).toBe("claude-haiku-4-5-20251001");
    expect(mapped.compat).toBe(undefined);
    expect(mapped.cost).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
});

test("names the model after its display name", () => {
    const [mapped] = mapApiModelsToProviderConfigs([
        apiModel("claude-opus-5", { display_name: "Claude Opus 5" }),
    ]);

    expect(mapped.id).toBe("claude-opus-5");
    expect(mapped.name).toBe("Claude Opus 5 (console)");
});
