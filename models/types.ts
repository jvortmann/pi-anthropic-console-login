export interface AnthropicModelInfo {
    id: string;
    display_name: string;
    created_at: string;
    type: "model";
    /** Context window. Absent on older responses; the traits table covers that case. */
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

export interface ModelTraits {
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
}
