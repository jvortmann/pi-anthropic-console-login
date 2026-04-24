import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";

const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

export function streamConsole(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
): AssistantMessageEventStream {
    const originalOnPayload = options?.onPayload;
    return streamSimple(
        { ...model, api: "anthropic-messages" } as Model<"anthropic-messages">,
        context,
        {
            ...options,
            onPayload: async (params: any, m: any) => {
                params.system = [
                    { type: "text", text: CLAUDE_CODE_IDENTITY, cache_control: { type: "ephemeral" } },
                    ...(params.system || []),
                ];
                return originalOnPayload ? originalOnPayload(params, m) : params;
            },
        },
    );
}
