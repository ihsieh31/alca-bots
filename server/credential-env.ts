// Credential env names and the strippers that keep them out of child processes. Lives apart from
// config.ts so the lists can grow (one name per engine) without that file growing with them.

/** Workspace credential env names; spawned engine CLIs must never inherit them. */
export const WORKSPACE_CREDENTIAL_ENV = [
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY",
  "ALCA_GROQ_API_KEY",
  "ALCA_GREENFERENCE_API_KEY",
  "ALCA_META_API_KEY",
  "ALCA_DEEPSEEK_API_KEY",
  "ALCA_ANTHROPIC_API_KEY",
  "ALCA_ANTHROPIC_API_URL",
  "ALCA_HOSTED_MODEL_TOKEN",
  "ALCA_HOSTED_MODELS",
  "OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPAT_URL",
  "ALCA_OPENAI_API_KEY",
  "ALCA_OPENROUTER_API_KEY",
  "BOX_TOKEN",
  "OPENCODE_API_KEY",
  "ALCA_TTS_KEY",
  "ALCA_FISH_AUDIO_API_KEY",
  "ALCA_GEMINI_API_KEY",
  "ALCA_JEV_API_KEY",
  "ALCA_OPENROUTER_DECIDER_KEY",
  "ALCA_WORKERS_AI_TOKEN",
  "ALCA_OPENAI_IMAGE_KEY",
  "ALCA_CUSTOM_IMAGE_KEY",
  "ALCA_GEMINI_IMAGE_KEY",
  "ALCA_OPENAI_LIVE_KEY", "ALCA_TREG_KEY", "ALCA_POSTIZ_API_KEY",
  "COMPOSIO_API_KEY",
  "ALCA_COMPOSIO_BROKER_TOKEN",
  "ALCA_CLOUD_BOAT_TOKEN",
  "ALCA_CLOUD_VOICE_TOKEN",
  "ALCA_CLOUD_DECIDER_TOKEN",
  "ALCA_CLOUD_AI_TOKEN", "ALCA_CLOUD_X_TOKEN", "ALCA_CLOUD_CONNECTED_APPS_GRANT",
  // Not credentials, but they point a shell-capable agent at app-owned state.
  "ALCA_BROWSER_CONNECTION", "ALCA_USER_DATA", "ALCA_BOAT_API",
] as const;

/** Operator secrets only this process reads, plus every `ALCA_CLOUD_` var (the underscore leaves out ALCA_CLOUDFLARED_PATH). */
export const CONTROL_PLANE_ENV = ["ALCA_LICENSE_KEY", "ALCA_INSTALLATION_CREDENTIAL"] as const;
export const CONTROL_PLANE_ENV_PREFIX = "ALCA_CLOUD_";

/** Names compare case-insensitively because Windows environments do. */
export function stripControlPlaneEnv(env: Record<string, string | undefined>): void {
  for (const key of Object.keys(env)) {
    const name = key.toUpperCase();
    if (name.startsWith(CONTROL_PLANE_ENV_PREFIX) || (CONTROL_PLANE_ENV as readonly string[]).includes(name)) delete env[key];
  }
}

export function stripWorkspaceCredentialEnv(env: Record<string, string | undefined>): void {
  for (const key of WORKSPACE_CREDENTIAL_ENV) delete env[key];
  stripControlPlaneEnv(env);
}

/** Env a provider CLI may read as its billing identity; a foreign key must never move a subscription CLI onto API billing. */
export const PROVIDER_CREDENTIAL_ENV = [
  "CLINE_API_KEY",
  "ANTHROPIC_API_KEY",
  "FACTORY_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "MINIMAX_API_KEY",
  "OPENAI_API_KEY",
  "OPENCODE_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY",
  "GROQ_API_KEY",
  "GREENFERENCE_API_KEY",
  "META_API_KEY",
  "DEEPSEEK_API_KEY",
  "CURSOR_API_KEY",
  "CURSOR_AUTH_TOKEN",
] as const;

/** Provider keys OpenCode reads from its environment (with ANTHROPIC_API_KEY set it lists Anthropic's models). */
export const OPENCODE_PROVIDER_ENV = [
  "CLINE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "MINIMAX_API_KEY",
  "GROQ_API_KEY",
  "DEEPSEEK_API_KEY",
] as const;
