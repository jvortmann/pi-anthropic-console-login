import type { AnthropicModelInfo, AnthropicModelListResponse } from "./types.js";

export async function fetchModels(apiKey: string): Promise<AnthropicModelInfo[] | null> {
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
