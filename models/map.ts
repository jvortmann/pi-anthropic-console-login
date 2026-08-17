import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { lookupTraits } from "./traits.js";
import type { AnthropicModelInfo, ModelCostLookup } from "./types.js";

export function mapApiModelsToProviderConfigs(
    models: AnthropicModelInfo[],
    lookupCost?: ModelCostLookup,
): ProviderModelConfig[] {
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
                reasoning: m.capabilities?.thinking?.supported ?? traits.reasoning,
                input: advertisedInput(m) ?? traits.input,
                cost: { ...(hostCost(m.id, lookupCost) ?? traits.cost) },
                contextWindow: m.max_input_tokens ?? traits.contextWindow,
                maxTokens: m.max_tokens ?? traits.maxTokens,
            };
        });
}

function hostCost(modelId: string, lookupCost?: ModelCostLookup): ProviderModelConfig["cost"] | undefined {
    try {
        return lookupCost?.(modelId);
    } catch {
        // The host catalog is an optional pricing source; the traits table still applies.
        return undefined;
    }
}

function advertisedInput(model: AnthropicModelInfo): ("text" | "image")[] | undefined {
    const imageInput = model.capabilities?.image_input;
    if (!imageInput) return undefined;
    return imageInput.supported ? ["text", "image"] : ["text"];
}
