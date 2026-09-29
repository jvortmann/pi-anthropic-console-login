import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { PROVIDER_API, PROVIDER_BASE_URL, PROVIDER_ID } from "../provider.js";
import { FALLBACK_MODELS } from "./fallback.js";
import { fetchModels } from "./fetch.js";
import { mapApiModelsToProviderConfigs, withHostModel } from "./map.js";
import type { AnthropicModelInfo, HostModelLookup } from "./types.js";

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

interface ModelsPublication {
    persist?: StoredCatalog | null;
    update?: () => void;
}

export interface ConsoleRefreshContext {
    credential?: RefreshCredential;
    /** Provider-scoped catalog snapshot pi captured before this refresh phase. */
    stored?: Readonly<StoredCatalog>;
    /** Generation-checked publication of the refreshed catalog. */
    publish?(publication: ModelsPublication): Promise<boolean>;
    allowNetwork: boolean;
    signal?: AbortSignal;
}

type ModelFetcher = (apiKey: string, signal?: AbortSignal) => Promise<AnthropicModelInfo[] | null>;

export async function refreshConsoleModels(
    context: ConsoleRefreshContext,
    fetchImpl: ModelFetcher = fetchModels,
    lookupHostModel?: HostModelLookup,
): Promise<ProviderModelConfig[]> {
    const cached = readStoredCatalog(context, lookupHostModel) ?? readFallbackCatalog(lookupHostModel);
    if (!context.allowNetwork) return cached;
    const apiKey = extractApiKey(context.credential);
    if (!apiKey) return cached;
    const models = await fetchImpl(apiKey, context.signal);
    if (!models || models.length === 0) return cached;

    const refreshed = mapApiModelsToProviderConfigs(models, lookupHostModel);
    await publishCatalog(context, refreshed);
    return refreshed;
}

function readStoredCatalog(
    context: ConsoleRefreshContext,
    lookupHostModel?: HostModelLookup,
): ProviderModelConfig[] | undefined {
    const entry = context.stored;
    if (!entry || entry.models.length === 0) return undefined;
    return entry.models.map((model) => withHostModel(toProviderModelConfig(model), lookupHostModel));
}

function readFallbackCatalog(lookupHostModel?: HostModelLookup): ProviderModelConfig[] {
    return FALLBACK_MODELS.map((model) => withHostModel(model, lookupHostModel));
}

async function publishCatalog(context: ConsoleRefreshContext, models: ProviderModelConfig[]): Promise<void> {
    try {
        await context.publish?.({
            persist: {
                models: models.map((model) => ({
                    ...model,
                    api: PROVIDER_API,
                    provider: PROVIDER_ID,
                    baseUrl: PROVIDER_BASE_URL,
                })),
                checkedAt: Date.now(),
            },
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
