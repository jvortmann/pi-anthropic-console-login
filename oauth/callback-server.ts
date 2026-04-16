import type { Server } from "node:http";
import { CALLBACK_HOST, CALLBACK_PATH, CALLBACK_PORT } from "./constants.js";

const SUCCESS_HTML = `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
<div style="text-align:center"><h2 style="color:#4ecca3">\u2713 Authentication complete</h2><p>You can close this window and return to pi.</p></div></body></html>`;

const ERROR_HTML = (msg: string) =>
    `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0">
<div style="text-align:center"><h2 style="color:#e74c3c">\u2717 Authentication failed</h2><p>${msg}</p></div></body></html>`;

export async function startCallbackServer(expectedState: string): Promise<{
    server: Server;
    waitForCode: () => Promise<{ code: string; state: string } | null>;
    cancelWait: () => void;
}> {
    const { createServer } = await import("node:http");
    return new Promise((resolve, reject) => {
        let settleWait: ((value: { code: string; state: string } | null) => void) | undefined;

        const waitForCodePromise = new Promise<{ code: string; state: string } | null>((resolveWait) => {
            let settled = false;
            settleWait = (value) => {
                if (settled) return;
                settled = true;
                resolveWait(value);
            };
        });

        const server = createServer((req, res) => {
            try {
                const url = new URL(req.url || "", "http://localhost");
                if (url.pathname !== CALLBACK_PATH) {
                    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(ERROR_HTML("Callback route not found."));
                    return;
                }

                const code = url.searchParams.get("code");
                const state = url.searchParams.get("state");
                const error = url.searchParams.get("error");

                if (error) {
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(ERROR_HTML(`Error: ${error}`));
                    return;
                }

                if (!code || !state) {
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(ERROR_HTML("Missing code or state parameter."));
                    return;
                }

                if (state !== expectedState) {
                    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                    res.end(ERROR_HTML("State mismatch."));
                    return;
                }

                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(SUCCESS_HTML);
                settleWait?.({ code, state });
            } catch {
                res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("Internal error");
            }
        });

        server.on("error", reject);
        server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
            resolve({
                server,
                cancelWait: () => settleWait?.(null),
                waitForCode: () => waitForCodePromise,
            });
        });
    });
}
