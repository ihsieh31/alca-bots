import { describe, expect, it } from "vitest";
import { connectionFingerprints } from "./cloud-connections.ts";
import { fingerprint } from "./cloud-send-verify.ts";
import type { AppConfig } from "./config.ts";

// Obvious fakes only.
const KEY = "sk-or-v1-fakeverify0000";
const NONCE = "x".repeat(43);

describe("credential fingerprints a move checks by", () => {
  it("cover keys, MCP servers' own secrets and the person's own connected-apps project, never a sign-in that moves once", () => {
    const config = { openrouter: { key: KEY }, composio: { apiKey: "fake-composio-key", userId: "u1" },
      mcpServers: { docs: { type: "http", url: "https://mcp.docs.example.test/mcp", headers: { Authorization: "Bearer fake-docs" }, enabled: true },
        dodo: { command: "node", args: ["server.js"], env: { DODO_KEY: "fake-dodo" }, enabled: true } } } as unknown as AppConfig;
    const seen = connectionFingerprints(NONCE, { config });
    expect(Object.keys(seen).sort()).toEqual(["composio", "key:openrouter", "mcp:docs", "mcp:dodo"]);
    expect(seen["key:openrouter"]).toBe(fingerprint(NONCE, { openrouter: { key: KEY } }));
    const changed = connectionFingerprints(NONCE, { config: { ...config, mcpServers: { ...config.mcpServers, docs: { ...(config.mcpServers!.docs as object), headers: { Authorization: "Bearer other" } } } } as AppConfig });
    expect(changed["mcp:docs"]).not.toBe(seen["mcp:docs"]);
    expect(JSON.stringify(seen)).not.toMatch(/fake-|sk-or/u);
  });
});
