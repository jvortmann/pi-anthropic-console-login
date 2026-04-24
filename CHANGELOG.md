# Changelog

## v1.3

### Fixes

- Fix console provider breaking built-in Anthropic connection
- Restore custom streaming layer under dedicated `anthropic-console-api` type so it no longer overrides the global `anthropic-messages` handler
- Re-add `@anthropic-ai/sdk` dependency (required for Claude Code identity headers and system prompt)

## v1.2

### Fixes

- Fix built-in Anthropic connection breaking when the plugin is installed
- Remove custom streaming layer and reuse the built-in Anthropic provider
- Remove `@anthropic-ai/sdk` dependency (no longer needed)

## v1.1

### Features

- Dynamic model discovery: fetches live model list from the Anthropic API on session start, no code update needed for new models
- Family-version pricing lookup with automatic fallback to the latest known version of the same model family
- Claude Opus 4.7 with xhigh effort level support (preserves max for Opus 4.6)

### Refactoring

- Modular codebase: split monolithic index.ts into `oauth/`, `models/`, `hooks/`, and `api/` modules

## v1.0

Initial release of the Anthropic Console OAuth provider for pi.

- OAuth login flow with PKCE and local callback server
- Automatic token refresh and API key creation
- Static model list: Claude Opus 4.6, Sonnet 4.6, Haiku 4.5
- Custom streaming implementation for the Anthropic Messages API
- Adaptive thinking and effort-level support
