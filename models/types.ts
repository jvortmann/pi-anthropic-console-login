import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export interface AnthropicModelInfo {
    id: string;
    display_name: string;
    created_at: string;
    type: "model";
    /** Context window. Absent on older responses. The traits table covers that case. */
    max_input_tokens?: number;
    /** Maximum output tokens. Absent on older responses. */
    max_tokens?: number;
    /** Per-model feature support. Absent on older responses. */
    capabilities?: {
        image_input?: { supported: boolean };
        thinking?: { supported: boolean };
    };
}

export interface AnthropicModelListResponse {
    data: AnthropicModelInfo[];
    has_more: boolean;
    first_id: string | null;
    last_id: string | null;
}

/**
 * The console reports no pricing and no request-shaping hints. The extension
 * takes them from the pi-ai catalog entry for the same model id.
 */
export interface HostModel {
    cost?: ProviderModelConfig["cost"];
    compat?: ProviderModelConfig["compat"];
    thinkingLevelMap?: ProviderModelConfig["thinkingLevelMap"];
    promptCache?: ProviderModelConfig["promptCache"];
    inputLimits?: ProviderModelConfig["inputLimits"];
}

/** Resolves the host catalog entry for a model id, when the host catalog knows it. */
export type HostModelLookup = (modelId: string) => HostModel | undefined;

export interface ModelTraits {
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
}
