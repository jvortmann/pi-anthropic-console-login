# pi-anthropic-console-login

A [pi](https://github.com/earendil-works/pi) package that adds **Anthropic Console** as an OAuth login provider. This authenticates against the Console (organization/API billing) instead of the personal claude.ai subscription.

## Requirements

- pi >= 0.84.0 (the extension refuses to load on older versions)

## Install

```bash
pi install git:github.com/jvortmann/pi-anthropic-console-login
```

## Usage

1. `/login` → select **"Anthropic Console account · API usage billing"**
2. Complete the OAuth flow in your browser
3. `/model` → select an `anthropic-console` model

## Models

The model list is discovered dynamically from your Console account and cached on disk. pi refreshes it after login and when the model selector opens, and restores the cached catalog at startup. Until the first successful refresh, a built-in fallback catalog is used.

Each model's context window, output limit, image support and reasoning support come from the Console API itself. Pricing and request-shaping settings, such as whether a model takes adaptive thinking and which thinking levels it accepts, are not reported by the Console, so they are read from the catalog pi maintains for its built-in `anthropic` provider, which covers the same model ids. A model that catalog does not know keeps the extension's own defaults.

## How it works

The extension registers an `anthropic-console` provider with OAuth support. On login it:

1. Opens the Anthropic Console OAuth authorization page
2. Exchanges the authorization code for tokens via PKCE
3. Creates an API key scoped to your organization
4. Registers models that use the Console API endpoint

The live model catalog is kept up to date through the provider's `refreshModels` callback, which reads the catalog snapshot pi passes in and persists each successful fetch through `publish`. Token refresh is handled automatically and retries transient connection failures, so a brief network outage does not end the session.

## License

MIT. See [LICENSE](LICENSE).
