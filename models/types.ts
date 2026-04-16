export interface AnthropicModelInfo {
    id: string;
    display_name: string;
    created_at: string;
    type: "model";
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
