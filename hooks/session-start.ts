import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { fetchModels, mapApiModelsToProviderConfigs } from "../models/index.js";

export function registerHooks(pi: ExtensionAPI, providerConfig: ProviderConfig): void {
    pi.on("session_start", async (_event, ctx) => {
        const apiKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic-console");
        if (!apiKey) return;

        const apiModels = await fetchModels(apiKey);
        if (!apiModels || apiModels.length === 0) return;

        const models = mapApiModelsToProviderConfigs(apiModels);
        if (models.length === 0) return;

        pi.registerProvider("anthropic-console", { ...providerConfig, models });
    });
}
