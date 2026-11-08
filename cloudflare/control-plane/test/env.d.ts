// Test-only Env additions: bindings the suite sets through vitest.config.ts or
// per test, which wrangler.jsonc (and so the generated worker-configuration.d.ts) does not declare.
export {};

interface TestEnvAdditions {
  CLOUDFLARE_ENDPOINT_ACCOUNTS?: unknown;
  CLOUDFLARE_API_TOKEN_ALCABOT_SI?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends TestEnvAdditions {}
  }
  // The suite casts to the global `Env` as well (worker-configuration.d.ts declares both).
  interface Env extends TestEnvAdditions {}
}
