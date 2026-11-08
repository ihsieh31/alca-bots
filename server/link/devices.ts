// The phones paired over Link. Each holds its harness session token, so the file is written owner-only and the token
// never leaves it except as the bridge's bearer on loopback.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";

import { fromB64u, toB64u } from "../../link/src/bytes.ts";
import type { PairedDevice } from "../../link/src/handshake.ts";
import type { DeviceDirectory, DeviceRecord } from "../../link/src/host.ts";
import type { LinkAccess, LinkDeviceView } from "../../shared/link.ts";
import { writeFileAtomic } from "../atomic.ts";

const row = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["phone", "hands"]),
  publicRaw: z.string(),
  access: z.enum(["full", "daily"]),
  revoked: z.boolean(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  sessionId: z.string().optional(),
  sessionToken: z.string().optional(),
});
type Row = z.infer<typeof row>;

export const scopesFor = (access: LinkAccess): Array<"admin" | "client"> => access === "full" ? ["admin", "client"] : ["client"];
const accessFor = (scopes: readonly string[]): LinkAccess => scopes.includes("admin") ? "full" : "daily";

const record = (r: Row): DeviceRecord => ({
  id: r.id, name: r.name, kind: r.kind, publicRaw: fromB64u(r.publicRaw), scopes: scopesFor(r.access), revoked: r.revoked,
});

export class LinkDevices implements DeviceDirectory {
  private rows = new Map<string, Row>();
  private readonly file: string;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    if (!existsSync(file)) return;
    const parsed = z.array(row).safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) throw new Error(`${file} is not a list of paired phones`);
    for (const r of parsed.data) this.rows.set(r.id, r);
  }

  private persist(): void {
    writeFileAtomic(this.file, `${JSON.stringify([...this.rows.values()], null, 2)}\n`, { mode: 0o600 });
  }

  get(id: string): DeviceRecord | undefined {
    const r = this.rows.get(id);
    return r && record(r);
  }

  add(d: PairedDevice, scopes: string[]): DeviceRecord {
    const now = this.now();
    const r: Row = {
      id: randomUUID(), name: d.name.slice(0, 80), kind: d.kind, publicRaw: toB64u(d.publicRaw),
      access: accessFor(scopes), revoked: false, createdAt: now, lastSeenAt: now,
    };
    this.rows.set(r.id, r);
    this.persist();
    return record(r);
  }

  seen(id: string): void {
    const r = this.rows.get(id);
    if (!r) return;
    r.lastSeenAt = this.now();
    this.persist();
  }

  session(id: string): { id?: string; token?: string } {
    const r = this.rows.get(id);
    return { ...(r?.sessionId ? { id: r.sessionId } : {}), ...(r?.sessionToken ? { token: r.sessionToken } : {}) };
  }

  setSession(id: string, sessionId: string, sessionToken: string): void {
    const r = this.rows.get(id);
    if (!r) return;
    r.sessionId = sessionId;
    r.sessionToken = sessionToken;
    this.persist();
  }

  bySession(sessionId: string): string | undefined {
    for (const r of this.rows.values()) if (r.sessionId === sessionId) return r.id;
    return undefined;
  }

  /** Forgets the session too: a revoked phone's token must not stay on disk. */
  revoke(id: string): { sessionId?: string } | null {
    const r = this.rows.get(id);
    if (!r) return null;
    const sessionId = r.sessionId;
    r.revoked = true;
    delete r.sessionId;
    delete r.sessionToken;
    this.persist();
    return sessionId ? { sessionId } : {};
  }

  remove(id: string): void {
    if (this.rows.delete(id)) this.persist();
  }

  list(online: (id: string) => "relay" | "rtc" | "lan" | null): LinkDeviceView[] {
    return [...this.rows.values()].filter((r) => !r.revoked).map((r) => ({
      id: r.id, name: r.name, access: r.access, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, connection: online(r.id),
    }));
  }
}
