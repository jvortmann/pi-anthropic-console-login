import type { ModelTraits } from "./types.js";

const KNOWN_MODEL_TRAITS: Record<string, ModelTraits> = {
    "opus:4.7": {
        reasoning: true, input: ["text", "image"],
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        contextWindow: 1000000, maxTokens: 128000,
    },
    "opus:4.6": {
        reasoning: true, input: ["text", "image"],
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        contextWindow: 1000000, maxTokens: 128000,
    },
    "sonnet:4.6": {
        reasoning: true, input: ["text", "image"],
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 1000000, maxTokens: 64000,
    },
    "sonnet:4.5": {
        reasoning: true, input: ["text", "image"],
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 200000, maxTokens: 16384,
    },
    "haiku:4.5": {
        reasoning: true, input: ["text", "image"],
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
        contextWindow: 200000, maxTokens: 64000,
    },
};

const DEFAULT_TRAITS: ModelTraits = {
    reasoning: true, input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000, maxTokens: 64000,
};

function parseFamilyVersion(modelId: string): { family: string; major: number; minor: number } | null {
    const families = ["opus", "sonnet", "haiku"];
    for (const family of families) {
        if (!modelId.includes(family)) continue;
        const match = modelId.match(new RegExp(`${family}[- ](\\d+)[-.](\\d+)`));
        if (match) return { family, major: Number(match[1]), minor: Number(match[2]) };
        const majorOnly = modelId.match(new RegExp(`${family}[- ](\\d{1,2})(?!\\d)`));
        if (majorOnly) return { family, major: Number(majorOnly[1]), minor: 0 };
    }
    return null;
}

export function lookupTraits(modelId: string): ModelTraits {
    const fv = parseFamilyVersion(modelId);
    if (!fv) return DEFAULT_TRAITS;

    const exactKey = `${fv.family}:${fv.major}.${fv.minor}`;
    if (KNOWN_MODEL_TRAITS[exactKey]) return KNOWN_MODEL_TRAITS[exactKey];

    // Fall back to the highest known version of the same family
    let best: { major: number; minor: number; traits: ModelTraits } | null = null;
    for (const [key, traits] of Object.entries(KNOWN_MODEL_TRAITS)) {
        const [keyFamily, keyVersion] = key.split(":");
        if (keyFamily !== fv.family) continue;
        const [keyMajor, keyMinor] = keyVersion.split(".").map(Number);
        if (!best || keyMajor > best.major || (keyMajor === best.major && keyMinor > best.minor)) {
            best = { major: keyMajor, minor: keyMinor, traits };
        }
    }

    return best?.traits ?? DEFAULT_TRAITS;
}
