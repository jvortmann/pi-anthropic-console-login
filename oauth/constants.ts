const decode = (s: string) => atob(s);

export const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
export const AUTHORIZE_URL = "https://platform.claude.com/oauth/authorize";
export const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const API_KEY_URL = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key";
export const MANUAL_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
export const SCOPES = "org:create_api_key user:profile";

export const CALLBACK_HOST = "127.0.0.1";
export const CALLBACK_PORT = 53693;
export const CALLBACK_PATH = "/callback";
export const LOCAL_REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
