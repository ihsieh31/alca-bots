import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { unstable_readConfig } from "wrangler";

const root = fileURLToPath(new URL(".", import.meta.url));
const TEST_AUTH_SECRET = "test-only-better-auth-secret-with-more-than-32-characters";
const TEST_CLOUDFLARE_TOKEN = "test-only-cloudflare-api-token-with-no-real-access";
const wranglerPath = fileURLToPath(new URL("./wrangler.jsonc", import.meta.url));
// The production account list, for the test that checks it parses.
const productionAccounts = unstable_readConfig({ config: wranglerPath }).vars.CLOUDFLARE_ENDPOINT_ACCOUNTS ?? [];
process.env.BETTER_AUTH_SECRET ??= TEST_AUTH_SECRET;
process.env.CLOUDFLARE_API_TOKEN ??= TEST_CLOUDFLARE_TOKEN;

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: wranglerPath },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
          CLOUDFLARE_API_TOKEN: TEST_CLOUDFLARE_TOKEN,
          // The suite starts from the primary account alone; the account
          // tests add accounts themselves.
          CLOUDFLARE_ENDPOINT_ACCOUNTS: "",
          TEST_PRODUCTION_ENDPOINT_ACCOUNTS: JSON.stringify(productionAccounts),
          ALLOWED_ORIGINS: "https://app.alcabots.test",
          // Test-only values the suite was written against; production now
          // differs (wrangler.jsonc), so the tests pin their own.
          RELAY_NODES: "bots-relay1.alca-corp.me,bots-relay2.alca-corp.me",
          RELAY_DISABLED: "0",
          ALCA_DNS_RECORD_LIMIT: "3500",
          ALCA_CLEANUP_SWEEP_LIMIT: "20",
          // The account the pre-0007 rows were tied to (migration 0007's default).
          CLOUDFLARE_ACCOUNT_ID: "0c92969a82eb9e173b013a7e7a02333d",
          // Production starts in observe (wrangler.jsonc); the suite exercises reclaiming.
          ALCA_TUNNEL_RECLAIM: "on",
          TEST_MIGRATIONS: await readD1Migrations(`${root}migrations`),
        },
        // An empty database for migration tests that need data written by an
        // older schema before the next migration runs.
        d1Databases: ["MIGRATION_DB"],
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
