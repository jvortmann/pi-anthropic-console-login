import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { PROVIDER_API, PROVIDER_BASE_URL, PROVIDER_ID } from "../provider.js";
import { FALLBACK_MODELS } from "./fallback.js";
import { fetchModels } from "./fetch.js";
import { mapApiModelsToProviderConfigs } from "./map.js";
import type { AnthropicModelInfo } from "./types.js";

interface RefreshCredential {
    type: "oauth" | "api_key";
    access?: string;
    key?: string;
}

interface StoredModel {
    id: string;
    name: string;
    api?: string;
    provider?: string;
    baseUrl?: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
}

interface StoredCatalog {
    models: readonly StoredModel[];
    checkedAt?: number;
}

interface ConsoleModelsStore {
    read(): Promise<StoredCatalog | undefined>;
    write(entry: StoredCatalog): Promise<void>;
}

export interface ConsoleRefreshContext {
    credential?: RefreshCredential;
    allowNetwork: boolean;
    signal?: AbortSignal;
    store?: ConsoleModelsStore;
}

type ModelFetcher = (apiKey: string, signal?: AbortSignal) => Promise<AnthropicModelInfo[] | null>;

export async function refreshConsoleModels(
    context: ConsoleRefreshContext,
    fetchImpl: ModelFetcher = fetchModels,
): Promise<ProviderModelConfig[]> {
    const stored = await readStoredCatalog(context.store);
    if (!context.allowNetwork) return stored ?? FALLBACK_MODELS;
    const apiKey = extractApiKey(context.credential);
    if (!apiKey) return stored ?? FALLBACK_MODELS;
    const models = await fetchImpl(apiKey, context.signal);
    if (!models || models.length === 0) return stored ?? FALLBACK_MODELS;

    const refreshed = mapApiModelsToProviderConfigs(models);
    await writeStoredCatalog(context.store, refreshed);
    return refreshed;
}

async function readStoredCatalog(store?: ConsoleModelsStore): Promise<ProviderModelConfig[] | undefined> {
    if (!store) return undefined;
    try {
        const entry = await store.read();
        if (!entry || entry.models.length === 0) return undefined;
        return entry.models.map(toProviderModelConfig);
    } catch {
        return undefined;
    }
}

async function writeStoredCatalog(
    store: ConsoleModelsStore | undefined,
    models: ProviderModelConfig[],
): Promise<void> {
    if (!store) return;
    try {
        await store.write({
            models: models.map((model) => ({
                ...model,
                api: PROVIDER_API,
                provider: PROVIDER_ID,
                baseUrl: PROVIDER_BASE_URL,
            })),
            checkedAt: Date.now(),
        });
    } catch {
        // Persisting the catalog is best-effort; the refreshed list is still returned.
    }
}

function toProviderModelConfig(model: StoredModel): ProviderModelConfig {
    return {
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input,
        cost: { ...model.cost },
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
    };
}

function extractApiKey(credential?: RefreshCredential): string | undefined {
    if (!credential) return undefined;
    if (credential.type === "oauth") return credential.access;
    return credential.key;
}
