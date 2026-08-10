export const MIN_PI_VERSION = "0.84.0";

export function isPiVersionSupported(version: string | undefined): boolean {
    if (!version) return false;
    const parsed = parseVersion(version);
    if (!parsed) return false;
    return compareVersions(parsed, parseVersion(MIN_PI_VERSION)!) >= 0;
}

export function requireSupportedPiVersion(version: string | undefined): void {
    if (isPiVersionSupported(version)) return;
    const found = version && version.length > 0 ? version : "unknown";
    throw new Error(
        `anthropic-console-login requires pi >= ${MIN_PI_VERSION} (found ${found}). Please update pi.`,
    );
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

function parseVersion(version: string): [number, number, number] | null {
    const parts = version.split(".").map((p) => Number.parseInt(p, 10));
    if (parts.length === 0 || !Number.isInteger(parts[0])) return null;
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
