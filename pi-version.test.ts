import { expect, test } from "bun:test";
import { isPiVersionSupported, requireSupportedPiVersion } from "./pi-version.js";

test("accepts the minimum supported pi version", () => {
    expect(isPiVersionSupported("0.81.0")).toBe(true);
});

test("accepts newer pi versions", () => {
    expect(isPiVersionSupported("0.81.1")).toBe(true);
    expect(isPiVersionSupported("0.82.0")).toBe(true);
    expect(isPiVersionSupported("1.0.0")).toBe(true);
});

test("rejects older pi versions", () => {
    expect(isPiVersionSupported("0.80.9")).toBe(false);
    expect(isPiVersionSupported("0.74.2")).toBe(false);
    expect(isPiVersionSupported("0.9.0")).toBe(false);
});

test("rejects missing or malformed versions", () => {
    expect(isPiVersionSupported(undefined)).toBe(false);
    expect(isPiVersionSupported("")).toBe(false);
    expect(isPiVersionSupported("not-a-version")).toBe(false);
});

test("throws a clear error for an unsupported version", () => {
    expect(() => requireSupportedPiVersion("0.80.0")).toThrow(/0\.81\.0/);
    expect(() => requireSupportedPiVersion(undefined)).toThrow(/0\.81\.0/);
});

test("passes through a supported version", () => {
    expect(() => requireSupportedPiVersion("0.81.0")).not.toThrow();
});
