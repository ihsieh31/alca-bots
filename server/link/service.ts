// The computer's side of connecting phones: one LinkHost while the owner keeps it on, its paired phones and their
// sessions, and the direct path.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { LinkError } from "../../link/src/errors.ts";
import { exportIdentity, generateIdentity, importIdentity, type Identity, type IdentityJwk } from "../../link/src/identity.ts";
import { LinkHost, type HostSession, type PairingOutcome } from "../../link/src/host.ts";
import { loadNodeRtc } from "../../link/src/node/werift.ts";
import { relayWsUrl } from "../../link/src/relay-protocol.ts";
import { RpcError } from "../../link/src/rpc.ts";
import { normalizeIceServers, RtcHost } from "../../link/src/rtc.ts";
import type { WebSocketCtor } from "../../link/src/transport.ts";
import {
  LINK_DEFAULT_ICE_SERVERS,
  LINK_DEFAULT_RELAY_URL,
  LINK_DEFAULT_SITE_URL,
  linkPairingUrl,
  type LinkAccess,
  type LinkPairingView,
  type LinkSettings,
  type LinkStatus,
} from "../../shared/link.ts";
import { writeFileAtomic } from "../atomic.ts";
import { createHttpBridge } from "./bridge.ts";
import { LinkDevices, scopesFor } from "./devices.ts";

export interface LinkSessions {
  issue(input: { label: string; scopes: Array<"admin" | "client"> }): { token: string; session: { id: string } };
  authenticate(token: string | undefined): { id: string } | null;
  revoke(id: string): boolean;
  onSessionRevoked(listener: (sessionId: string, why: "revoked" | "expired") => void): () => void;
}

export interface LinkServiceOptions {
  dataDir: string;
  port: number;
  sessions: LinkSessions;
  computerName(): string;
  remoteAccessRefusal?(): string | undefined;
  env?: Record<string, string | undefined>;
  WebSocketImpl?: WebSocketCtor;
  log?: (message: string) => void;
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  relayUrl: z.string().optional(),
  siteUrl: z.string().optional(),
  iceServers: z.array(z.string()).optional(),
});

const secureUrl = (value: string, label: string, allowInsecureLoopback: boolean): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RpcError("bad_request", `${label} is not a web address`);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  const insecure = url.protocol === "http:" || url.protocol === "ws:";
  if (!secure && !(insecure && loopback && allowInsecureLoopback)) throw new RpcError("bad_request", `${label} must use https`);
  return url.toString().replace(/\/+$/, "");
};

export class LinkService {
  readonly devices: LinkDevices;
  private readonly o: LinkServiceOptions;
  private readonly dir: string;
  private settingsNow: LinkSettings;
  private host: LinkHost | null = null;
  private rtc: RtcHost | null = null;
  private fingerprint: string | null = null;
  private pairing: LinkPairingView | null = null;
  private error: string | null = null;
  private starting: Promise<void> | null = null;

  constructor(o: LinkServiceOptions) {
    this.o = o;
    this.dir = join(o.dataDir, "link");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.devices = new LinkDevices(join(this.dir, "devices.json"));
    this.settingsNow = this.readSettings();
    // An expired session only means a phone was away for a long time: the next connection gets a new one.
    o.sessions.onSessionRevoked((sessionId, why) => {
      if (why === "revoked") this.sessionRevoked(sessionId);
    });
  }

  private readSettings(): LinkSettings {
    const env = this.o.env ?? process.env;
    const file = join(this.dir, "settings.json");
    const saved = existsSync(file) ? settingsSchema.parse(JSON.parse(readFileSync(file, "utf8"))) : {};
    return {
      enabled: saved.enabled ?? false,
      relayUrl: env.ALCA_LINK_RELAY_URL?.trim() || saved.relayUrl || LINK_DEFAULT_RELAY_URL,
      siteUrl: env.ALCA_LINK_SITE_URL?.trim() || saved.siteUrl || LINK_DEFAULT_SITE_URL,
      iceServers: normalizeIceServers(saved.iceServers ?? LINK_DEFAULT_ICE_SERVERS),
    };
  }

  private async identity(): Promise<Identity> {
    const file = join(this.dir, "identity.json");
    if (existsSync(file)) return importIdentity(JSON.parse(readFileSync(file, "utf8")) as IdentityJwk);
    const identity = await generateIdentity(true);
    writeFileAtomic(file, `${JSON.stringify(await exportIdentity(identity))}\n`, { mode: 0o600 });
    return identity;
  }

  /** Starts the service if the owner turned it on. Failing to reach a relay is not an error: the host keeps retrying. */
  start(): Promise<void> {
    if (!this.settingsNow.enabled || this.host) return Promise.resolve();
    this.starting ??= this.open().catch((error: unknown) => {
      this.error = error instanceof Error ? error.message : "could not start";
      this.o.log?.(`link: ${this.error}`);
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  private async open(): Promise<void> {
    this.error = null;
    const identity = await this.identity();
    const { relayUrl, iceServers } = this.settingsNow;
    const host: LinkHost = new LinkHost({
      relayUrl,
      identity,
      coreName: this.o.computerName(),
      devices: this.devices,
      readyInfo: () => this.rtc?.readyInfo() ?? {},
      onSession: (session) => this.onSession(session),
      ...(this.o.WebSocketImpl ? { WebSocketImpl: this.o.WebSocketImpl } : {}),
      ...(this.o.log ? { log: this.o.log } : {}),
    });
    host.onPairing((outcome) => this.onPairing(outcome));
    const factory = iceServers.length ? await loadNodeRtc((message) => this.o.log?.(message)) : undefined;
    if (factory) {
      this.rtc = new RtcHost({
        factory,
        iceServers,
        accept: async (wire) => {
          const session = await host.acceptWire(wire, "rtc");
          return session ? { deviceId: session.device.id, close: (reason: string) => session.peer.close(reason) } : undefined;
        },
        ...(this.o.log ? { log: this.o.log } : {}),
      });
    }
    this.host = host;
    await host.start();
    this.fingerprint = host.coreFingerprint;
  }

  async stop(): Promise<void> {
    await this.starting;
    this.rtc?.close();
    this.rtc = null;
    const host = this.host;
    this.host = null;
    this.pairing = null;
    await host?.close();
  }

  private sessionToken(deviceId: string): string {
    const { sessions } = this.o;
    const saved = this.devices.session(deviceId);
    if (saved.token && sessions.authenticate(saved.token)) return saved.token;
    const device = this.devices.get(deviceId);
    if (!device || device.revoked) throw new RpcError("revoked", "this phone was removed");
    const scopes = device.scopes.filter((scope): scope is "admin" | "client" => scope === "admin" || scope === "client");
    const { token, session } = sessions.issue({ label: device.name, scopes });
    this.devices.setSession(deviceId, session.id, token);
    return token;
  }

  private onSession(session: HostSession): void {
    const deviceId = session.device.id;
    const bridge = createHttpBridge({
      remoteAccessRefusal: () => this.o.remoteAccessRefusal?.(),
      peer: session.peer,
      overRelay: session.via === "relay",
      port: this.o.port,
      sessionToken: () => this.sessionToken(deviceId),
    });
    session.peer.handle(async (op, args) => {
      if (op === "ping") return "pong";
      if (op === "rtc.offer") return this.rtcOffer(deviceId, args);
      const handler = bridge[op];
      if (!handler) throw new RpcError("unsupported", `unknown op ${op}`);
      return handler(args);
    });
  }

  private async rtcOffer(deviceId: string, args: Record<string, unknown>): Promise<{ sdp: string }> {
    if (!this.rtc) throw new RpcError("unavailable", "direct connection is off");
    try {
      return await this.rtc.answer(deviceId, args.sdp);
    } catch (error) {
      const code = error instanceof LinkError ? error.code : "failed";
      throw new RpcError(code === "rate_limited" ? "busy" : code === "malformed" ? "bad_request" : "unavailable", "direct connection failed");
    }
  }

  private onPairing(outcome: PairingOutcome): void {
    const current = this.pairing;
    if (!current || current.nameplate !== outcome.nameplate) return;
    if (outcome.ok) {
      this.sessionToken(outcome.device.id);
      this.pairing = { ...current, state: "paired", deviceName: outcome.device.name };
    } else if (!outcome.attemptsLeft) {
      this.pairing = { ...current, state: "failed", error: outcome.error };
    }
  }

  private sessionRevoked(sessionId: string): void {
    const deviceId = this.devices.bySession(sessionId);
    if (deviceId) this.revokeDevice(deviceId);
  }

  status(): LinkStatus {
    const host = this.host;
    return {
      ...this.settingsNow,
      status: !this.settingsNow.enabled || !host ? "off" : host.status,
      fingerprint: this.fingerprint,
      devices: this.devices.list((id) => host?.sessions(id).reduce<"relay" | "rtc" | "lan" | null>(
        (best, session) => best === "rtc" ? best : session.via, null,
      ) ?? null),
      pairing: this.pairing,
      error: this.error,
    };
  }

  /** Saves the settings, then reconnects if what the host was started with changed. */
  async update(patch: unknown): Promise<LinkStatus> {
    const parsed = settingsSchema.safeParse(patch);
    if (!parsed.success) throw new RpcError("bad_request", "bad settings");
    const local = (this.o.env ?? process.env).ALCA_LINK_ALLOW_LOOPBACK === "1";
    const { enabled, relayUrl, siteUrl, iceServers } = parsed.data;
    const next: LinkSettings = {
      enabled: enabled ?? this.settingsNow.enabled,
      relayUrl: relayUrl === undefined ? this.settingsNow.relayUrl : secureUrl(relayUrl, "The relay address", local),
      siteUrl: siteUrl === undefined ? this.settingsNow.siteUrl : secureUrl(siteUrl, "The phone site address", local),
      iceServers: iceServers === undefined ? this.settingsNow.iceServers : normalizeIceServers(iceServers),
    };
    if (next.relayUrl) relayWsUrl(next.relayUrl);
    const restart = next.enabled !== this.settingsNow.enabled || next.relayUrl !== this.settingsNow.relayUrl
      || next.iceServers.join() !== this.settingsNow.iceServers.join();
    this.settingsNow = next;
    writeFileAtomic(join(this.dir, "settings.json"), `${JSON.stringify(next, null, 2)}\n`);
    if (restart) {
      await this.stop();
      await this.start();
    }
    return this.status();
  }

  async createPairing(access: LinkAccess): Promise<LinkPairingView> {
    if (!this.host) throw new RpcError("offline", "Turn on phone access first");
    if (this.pairing?.state === "open") this.host.cancelPairing(this.pairing.nameplate);
    try {
      const made = await this.host.createPairing({ scopes: scopesFor(access), ttlSec: 300 });
      this.pairing = {
        nameplate: made.nameplate,
        display: made.display,
        expiresAt: made.expiresAt,
        access,
        url: linkPairingUrl({
          siteUrl: this.settingsNow.siteUrl, code: made.code, fingerprint: made.coreFingerprint, relayUrl: this.settingsNow.relayUrl,
        }),
        state: "open",
      };
      return this.pairing;
    } catch (error) {
      if (error instanceof LinkError && (error.code === "offline" || error.code === "timeout")) {
        throw new RpcError("offline", "This computer can't reach the relay right now");
      }
      throw new RpcError("failed", "Couldn't make a pairing code");
    }
  }

  cancelPairing(nameplate: string): void {
    if (this.pairing?.nameplate !== nameplate) return;
    this.host?.cancelPairing(nameplate);
    this.pairing = null;
  }

  revokeDevice(id: string): boolean {
    const revoked = this.devices.revoke(id);
    if (!revoked) return false;
    if (revoked.sessionId) this.o.sessions.revoke(revoked.sessionId);
    this.host?.disconnect(id);
    return true;
  }
}
