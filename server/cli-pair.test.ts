import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPair, type CliOptions } from "./cli.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const mocks = vi.hoisted(() => ({
  readCliStartup: vi.fn(),
  createTunnelAccount: vi.fn(), describeTunnelAccount: vi.fn(), tailscaleStatus: vi.fn(),
  ui: { log: vi.fn(), choose: vi.fn(), ask: vi.fn(), secret: vi.fn(), confirm: vi.fn() },
}));
vi.mock("./cli-setup.ts", () => ({ readCliStartup: mocks.readCliStartup }));
vi.mock("./cli-prompts.ts", async (original) => ({
  ...await original<typeof import("./cli-prompts.ts")>(), defaultSetupIo: () => mocks.ui,
}));
vi.mock("./tailscale.ts", () => ({
  tailscaleStatus: mocks.tailscaleStatus,
  tailscaleServe: vi.fn(), tailscaleServeOff: vi.fn(), explainTailscaleFailure: vi.fn(),
}));
vi.mock("./tunnel.ts", () => ({
  createTunnelAccount: mocks.createTunnelAccount, describeTunnelAccount: mocks.describeTunnelAccount,
  cleanupTunnelOrigin: vi.fn(), createTunnelOrigin: vi.fn(), describeTunnelState: vi.fn(),
  ensureCloudflared: vi.fn(), guardianEntry: vi.fn(), startTunnel: vi.fn(), tunnelAccess: vi.fn(),
}));

const advertisedOrigin = "https://current.example.test";
const explicitOrigin = "https://override.example.test";
const workspaceId = "4e406646-1030-4613-8878-e227ab722ffc";
const code = "ABCD-EFGH-JKLM";
const ttyDescriptors = [process.stdin, process.stdout].map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));
let dataDir: string;
let options: CliOptions;
let publicUrl: string | null;
let remoteWorkspaceId: string;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  // The shared test setup supplies a throwaway HOME before module imports.
  dataDir = mkdtempSync(join(process.env.HOME!, "cli-pair-"));
  vi.stubEnv("ALCA_DATA_DIR", dataDir);
  options = { command: "pair", port: 18451, dataDir, tailscale: false, client: false, pair: true, json: false };
  publicUrl = advertisedOrigin;
  remoteWorkspaceId = workspaceId;
  for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, "isTTY", { value: true, configurable: true });
  mocks.ui.choose.mockResolvedValue(0);
  mocks.createTunnelAccount.mockReturnValue({ credentials: { read: () => ({}) } });
  mocks.describeTunnelAccount.mockReturnValue({ address: "https://old-tunnel.example.test", email: "fixture@example.test" });
  mocks.tailscaleStatus.mockResolvedValue({ status: { dnsName: "old-tailnet.example.test" } });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const local = `http://127.0.0.1:${options.port}`;
    if (url === `${local}/api/health`) return Response.json({ app: "alcabots", pid: 12345 });
    if (url === `${local}/api/auth/pairing`) {
      if (init?.method === "POST") return Response.json({ code, expiresAt: Date.now() + 300_000, url: `${advertisedOrigin}/pair#code=${code}` });
      return Response.json({ pairings: [], publicUrl });
    }
    if (url === `${local}/.well-known/alcabots/environment`) return Response.json({ environmentId: workspaceId });
    if ([advertisedOrigin, explicitOrigin].some((origin) => url === `${origin}/.well-known/alcabots/environment`)) {
      return Response.json({ environmentId: remoteWorkspaceId });
    }
    // No real network fallback is allowed, including stale saved addresses.
    throw new Error(`Unexpected fixture request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const [index, stream] of [process.stdin, process.stdout].entries()) {
    const descriptor = ttyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
    else Reflect.deleteProperty(stream, "isTTY");
  }
  await removeTempDir(dataDir);
});


// `alcabots pair` talks to 127.0.0.1, so the server answers as its owner and builds the phone-app invite from its own
// public address; the CLI prints it as it is and builds its own only for --public-url.

describe("pair --ttl", () => {
  it("asks the server to keep the code open that long, skips the phone questions, and prints the day it ends", async () => {
    const day = Date.now() + 86_400_000;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/health")) return Response.json({ app: "alcabots", pid: 12345 });
      if (url.endsWith("/api/auth/pairing") && init?.method === "POST") return Response.json({ code, expiresAt: day, url: null, hint: "set ALCA_PUBLIC_URL" });
      throw new Error(`Unexpected fixture request: ${url}`);
    });
    expect(await runPair({ ...options, pairTtlMs: 86_400_000 })).toBe(0);
    const posted = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(posted![1]!.body))).toEqual({ ttlMs: 86_400_000 });
    expect(mocks.ui.choose).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.map(([line]) => String(line)).join("\n")).toContain(`expires:       ${new Date(day).toLocaleString()} (single use)`);
  });
});
