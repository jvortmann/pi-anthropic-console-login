# anthropic-console-login

A [pi](https://github.com/earendil-works/pi) package that adds **Anthropic Console** as an OAuth login provider. This authenticates against the Console (organization/API billing) instead of the personal claude.ai subscription.

## Requirements

- pi >= 0.81.0 (the extension refuses to load on older versions)

## Install

```bash
pi install git:github.com/jvortmann/anthropic-console-login
```

## Usage

1. `/login` → select **"Anthropic Console account · API usage billing"**
2. Complete the OAuth flow in your browser
3. `/model` → select an `anthropic-console` model

## Models

The model list is discovered dynamically from your Console account and refreshed by pi after login, when the model selector opens, and at startup. When offline or before login, a built-in fallback catalog is used.

## How it works

The extension registers an `anthropic-console` provider with OAuth support. On login it:

1. Opens the Anthropic Console OAuth authorization page
2. Exchanges the authorization code for tokens via PKCE
3. Creates an API key scoped to your organization
4. Registers models that use the Console API endpoint

The live model catalog is kept up to date through the provider's `refreshModels` callback. Token refresh is handled automatically.

## License

MIT
