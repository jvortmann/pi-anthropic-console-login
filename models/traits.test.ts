import { expect, test } from "bun:test";
import { lookupTraits } from "./traits.js";

test("gives a single-segment opus version the newest known opus traits", () => {
    const traits = lookupTraits("claude-opus-5");

    expect(traits.contextWindow).toBe(1000000);
    expect(traits.maxTokens).toBe(128000);
    expect(traits.cost).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
});

test("gives a single-segment sonnet version the newest known sonnet traits", () => {
    const traits = lookupTraits("claude-sonnet-5");

    expect(traits.contextWindow).toBe(1000000);
    expect(traits.maxTokens).toBe(64000);
    expect(traits.cost).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
});

test("treats a bare date suffix as an unknown version rather than a version number", () => {
    const traits = lookupTraits("claude-3-opus-20240229");

    expect(traits.contextWindow).toBe(200000);
    expect(traits.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("keeps an unfamiliar model family on the conservative defaults", () => {
    const traits = lookupTraits("claude-fable-5");

    expect(traits.contextWindow).toBe(200000);
    expect(traits.maxTokens).toBe(64000);
    expect(traits.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("keeps a dated release on the traits of its own version", () => {
    const traits = lookupTraits("claude-haiku-4-5-20251001");

    expect(traits.contextWindow).toBe(200000);
    expect(traits.maxTokens).toBe(64000);
    expect(traits.cost).toEqual({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
});
