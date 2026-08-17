/**
 * Anthropic Console OAuth Provider
 *
 * Adds "Anthropic Console account" as a login option in pi,
 * authenticating against the Console (organization/API billing)
 * instead of the personal claude.ai subscription.
 *
 * Requires pi >= 0.84.0.
 *
 * Usage:
 *   1. /login → select "Anthropic Console account · API usage billing"
 *   2. /model → select an anthropic-console model
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import { streamConsole } from "./api/stream.js";
import { FALLBACK_MODELS, fetchModels, refreshConsoleModels } from "./models/index.js";
import { login, refreshToken } from "./oauth/index.js";
import { requireSupportedPiVersion } from "./pi-version.js";
import { HOST_CATALOG_PROVIDER_ID, PROVIDER_API, PROVIDER_BASE_URL, PROVIDER_ID } from "./provider.js";

export default function (pi: ExtensionAPI) {
    requireSupportedPiVersion((codingAgent as { VERSION?: string }).VERSION);

    // The console serves the same models as the built-in provider but reports no
    // pricing, so costs are read from the catalog pi already keeps current.
    const lookupCost = (modelId: string) => pi.modelRegistry.find(HOST_CATALOG_PROVIDER_ID, modelId)?.cost;

    pi.registerProvider(PROVIDER_ID, {
        baseUrl: PROVIDER_BASE_URL,
        apiKey: "$ANTHROPIC_CONSOLE_API_KEY",
        api: PROVIDER_API,
        models: FALLBACK_MODELS,
        refreshModels: (context) => refreshConsoleModels(context, fetchModels, lookupCost),
        oauth: {
            name: "Anthropic Console account \u00b7 API usage billing",
            login,
            refreshToken,
            getApiKey: (cred: { access: string }) => cred.access,
        },
        streamSimple: streamConsole,
    });
}
