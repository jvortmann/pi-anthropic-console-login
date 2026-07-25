import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { FALLBACK_MODELS } from "./fallback.js";
import { fetchModels } from "./fetch.js";
import { mapApiModelsToProviderConfigs } from "./map.js";
import type { AnthropicModelInfo } from "./types.js";

interface RefreshCredential {
    type: "oauth" | "api_key";
    access?: string;
    key?: string;
}

export interface ConsoleRefreshContext {
    credential?: RefreshCredential;
    allowNetwork: boolean;
    signal?: AbortSignal;
}

type ModelFetcher = (apiKey: string, signal?: AbortSignal) => Promise<AnthropicModelInfo[] | null>;

export async function refreshConsoleModels(
    context: ConsoleRefreshContext,
    fetchImpl: ModelFetcher = fetchModels,
): Promise<ProviderModelConfig[]> {
    if (!context.allowNetwork) return FALLBACK_MODELS;
    const apiKey = extractApiKey(context.credential);
    if (!apiKey) return FALLBACK_MODELS;
    const models = await fetchImpl(apiKey, context.signal);
    if (!models || models.length === 0) return FALLBACK_MODELS;
    return mapApiModelsToProviderConfigs(models);
}

function extractApiKey(credential?: RefreshCredential): string | undefined {
    if (!credential) return undefined;
    if (credential.type === "oauth") return credential.access;
    return credential.key;
}
