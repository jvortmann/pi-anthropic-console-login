/**
 * OAuth endpoint transport.
 *
 * Console token refresh runs unattended in the background, where a DNS blip or
 * a connect timeout would otherwise end the session. Connection failures are
 * retried with exponential backoff, and a caller can limit which ones. HTTP
 * responses come back untouched, so callers decide what a status code means.
 */

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export interface RequestOptions {
    signal?: AbortSignal;
    attempts?: number;
    retryDelayMs?: number;
    /** Decides whether an error is safe to retry. Every error is, by default. */
    retryOn?: (error: unknown) => boolean;
}

/** Codes for a fetch that failed before the request left the machine. Node puts them on the cause, Bun on the error. */
const UNSENT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "ConnectionRefused"]);

export function neverSent(error: unknown): boolean {
    const failure = error as { code?: unknown; cause?: { code?: unknown } } | undefined;
    return UNSENT_CODES.has(String(failure?.cause?.code ?? failure?.code));
}

export async function fetchWithRetry(
    url: string,
    init: RequestInit,
    options: RequestOptions = {},
): Promise<Response> {
    const attempts = Math.max(1, options.attempts ?? MAX_ATTEMPTS);
    const retryDelayMs = options.retryDelayMs ?? RETRY_BASE_DELAY_MS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        options.signal?.throwIfAborted();
        try {
            return await fetch(url, { ...init, signal: options.signal });
        } catch (error) {
            options.signal?.throwIfAborted();
            lastError = error;
            if (options.retryOn && !options.retryOn(error)) break;
            if (attempt < attempts) await delay(retryDelayMs * 2 ** (attempt - 1), options.signal);
        }
    }

    throw lastError;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
