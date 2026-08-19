import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { lookupTraits } from "./traits.js";
import type { AnthropicModelInfo, HostModel, HostModelLookup } from "./types.js";

export function mapApiModelsToProviderConfigs(
    models: AnthropicModelInfo[],
    lookupHostModel?: HostModelLookup,
): ProviderModelConfig[] {
    return models
        .filter((m) => {
            const id = m.id.toLowerCase();
            return id.includes("claude") && !id.includes("embed");
        })
        .map((m) => {
            const traits = lookupTraits(m.id);
            const host = hostModel(m.id, lookupHostModel);
            return {
                id: m.id,
                name: `${m.display_name} (console)`,
                reasoning: m.capabilities?.thinking?.supported ?? traits.reasoning,
                input: advertisedInput(m) ?? traits.input,
                cost: { ...(host?.cost ?? traits.cost) },
                contextWindow: m.max_input_tokens ?? traits.contextWindow,
                maxTokens: m.max_tokens ?? traits.maxTokens,
                compat: host?.compat,
                thinkingLevelMap: host?.thinkingLevelMap,
            };
        });
}

function hostModel(modelId: string, lookupHostModel?: HostModelLookup): HostModel | undefined {
    try {
        return lookupHostModel?.(modelId);
    } catch {
        // The host catalog is an optional source; the traits table still applies.
        return undefined;
    }
}

function advertisedInput(model: AnthropicModelInfo): ("text" | "image")[] | undefined {
    const imageInput = model.capabilities?.image_input;
    if (!imageInput) return undefined;
    return imageInput.supported ? ["text", "image"] : ["text"];
}
