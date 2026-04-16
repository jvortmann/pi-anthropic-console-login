import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { lookupTraits } from "./traits.js";
import type { AnthropicModelInfo } from "./types.js";

export function mapApiModelsToProviderConfigs(models: AnthropicModelInfo[]): ProviderModelConfig[] {
    return models
        .filter((m) => {
            const id = m.id.toLowerCase();
            return id.includes("claude") && !id.includes("embed");
        })
        .map((m) => {
            const traits = lookupTraits(m.id);
            return {
                id: m.id,
                name: `${m.display_name} (console)`,
                reasoning: traits.reasoning,
                input: traits.input,
                cost: { ...traits.cost },
                contextWindow: traits.contextWindow,
                maxTokens: traits.maxTokens,
            };
        });
}
