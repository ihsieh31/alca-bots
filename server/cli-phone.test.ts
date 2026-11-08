import { describe, expect, it, vi } from "vitest";

import { runPhonePairing, type PhonePairingDeps } from "./cli-phone.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pairing = { url: "https://site.example/#pair=123456789", display: "123-456-789", expiresAt: new Date(Date.now() + 60_000).toISOString() };

function deps(status: string, overrides: Partial<PhonePairingDeps> = {}) {
  const lines: string[] = [];
  const errors: string[] = [];
  const calls: Array<{ method: string; path: string; body?: string }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ method: init?.method ?? "GET", path, ...(init?.body ? { body: String(init.body) } : {}) });
    if (path === "/api/link/pairings") return json(pairing);
    return json({ status, relayUrl: "https://relay.example", siteUrl: "https://site.example" });
  }) as unknown as typeof fetch;
  return { lines, errors, calls, value: { log: (l: string) => lines.push(l), error: (l: string) => errors.push(l), fetch: fetcher, sleep: async () => {}, ...overrides } };
}

describe("alcabots phone", () => {
  it("turns access on, then shows the code, the address and how much the phone can do", async () => {
    const d = deps("online");
    expect(await runPhonePairing(8799, {}, d.value)).toBe(0);
    expect(d.calls[0]).toEqual({ method: "PATCH", path: "/api/link", body: JSON.stringify({ enabled: true }) });
    expect(d.calls.at(-1)).toEqual({ method: "POST", path: "/api/link/pairings", body: JSON.stringify({ access: "full" }) });
    const text = d.lines.join("\n");
    expect(text).toContain("123-456-789");
    expect(text).toContain("https://site.example");
    expect(text).toContain("full access");
  });

  it("--daily asks for daily use", async () => {
    const d = deps("online");
    expect(await runPhonePairing(8799, { daily: true }, d.value)).toBe(0);
    expect(d.calls.at(-1)?.body).toBe(JSON.stringify({ access: "daily" }));
  });

  it("makes no code when the relay can't be reached, and says which one", async () => {
    const d = deps("offline");
    expect(await runPhonePairing(8799, {}, d.value)).toBe(1);
    expect(d.errors[0]).toContain("https://relay.example");
    expect(d.calls.some((call) => call.path === "/api/link/pairings")).toBe(false);
  });

  it("says when nothing answers on that port", async () => {
    const d = deps("online", { fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    expect(await runPhonePairing(8799, {}, d.value)).toBe(1);
    expect(d.errors[0]).toContain("alcabots serve");
  });
});
