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

test("names the model after its display name", () => {
    const [mapped] = mapApiModelsToProviderConfigs([
        apiModel("claude-opus-5", { display_name: "Claude Opus 5" }),
    ]);

    expect(mapped.id).toBe("claude-opus-5");
    expect(mapped.name).toBe("Claude Opus 5 (console)");
});
