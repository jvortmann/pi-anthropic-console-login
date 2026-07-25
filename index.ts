/**
 * Anthropic Console OAuth Provider
 *
 * Adds "Anthropic Console account" as a login option in pi,
 * authenticating against the Console (organization/API billing)
 * instead of the personal claude.ai subscription.
 *
 * Usage:
 *   1. Install deps: cd ~/.config/pi/extensions/anthropic-console && npm install
 *   2. Restart pi (or /reload)
 *   3. /login → select "Anthropic Console account · API usage billing"
 *   4. /model → select an anthropic-console model
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { streamConsole } from "./api/stream.js";
import { registerHooks } from "./hooks/index.js";
import { FALLBACK_MODELS } from "./models/index.js";
import { login, refreshToken } from "./oauth/index.js";

export default function (pi: ExtensionAPI) {
    const providerConfig = {
        baseUrl: "https://api.anthropic.com",
        apiKey: "$ANTHROPIC_CONSOLE_API_KEY",
        api: "anthropic-console-api" as const,
        models: FALLBACK_MODELS,
        oauth: {
            name: "Anthropic Console account \u00b7 API usage billing",
            usesCallbackServer: true,
            login,
            refreshToken,
            getApiKey: (cred: { access: string }) => cred.access,
        },
        streamSimple: streamConsole,
    };

    pi.registerProvider("anthropic-console", providerConfig);
    registerHooks(pi, providerConfig);
}
