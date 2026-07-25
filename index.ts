/**
 * Anthropic Console OAuth Provider
 *
 * Adds "Anthropic Console account" as a login option in pi,
 * authenticating against the Console (organization/API billing)
 * instead of the personal claude.ai subscription.
 *
 * Requires pi >= 0.81.0.
 *
 * Usage:
 *   1. /login → select "Anthropic Console account · API usage billing"
 *   2. /model → select an anthropic-console model
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import { streamConsole } from "./api/stream.js";
import { FALLBACK_MODELS, refreshConsoleModels } from "./models/index.js";
import { login, refreshToken } from "./oauth/index.js";
import { requireSupportedPiVersion } from "./pi-version.js";

export default function (pi: ExtensionAPI) {
    requireSupportedPiVersion((codingAgent as { VERSION?: string }).VERSION);

    pi.registerProvider("anthropic-console", {
        baseUrl: "https://api.anthropic.com",
        apiKey: "$ANTHROPIC_CONSOLE_API_KEY",
        api: "anthropic-console-api" as const,
        models: FALLBACK_MODELS,
        refreshModels: refreshConsoleModels,
        oauth: {
            name: "Anthropic Console account \u00b7 API usage billing",
            login,
            refreshToken,
            getApiKey: (cred: { access: string }) => cred.access,
        },
        streamSimple: streamConsole,
    });
}
