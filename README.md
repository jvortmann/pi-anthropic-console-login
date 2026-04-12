# anthropic-console-login

A [pi](https://github.com/badlogic/pi-mono) package that adds **Anthropic Console** as an OAuth login provider. This authenticates against the Console (organization/API billing) instead of the personal claude.ai subscription.

## Install

```bash
pi install git:github.com/jvortmann/anthropic-console-login
```

## Usage

1. `/login` → select **"Anthropic Console account · API usage billing"**
2. Complete the OAuth flow in your browser
3. `/model` → select an `anthropic-console` model

## Models

| Model | Reasoning |
|-------|-----------|
| Claude Opus 4.6 (console) | ✓ |
| Claude Sonnet 4.6 (console) | ✓ |
| Claude Haiku 4.5 (console) | ✓ |

## How it works

The extension registers an `anthropic-console` provider with OAuth support. On login it:

1. Opens the Anthropic Console OAuth authorization page
2. Exchanges the authorization code for tokens via PKCE
3. Creates an API key scoped to your organization
4. Registers models that use the Console API endpoint

Token refresh is handled automatically.

## License

MIT
