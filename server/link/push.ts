// Which phones want notifications, and getting one to them when they aren't looking at the app.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { Notification } from "../../shared/notification.ts";
import { writeFileAtomic } from "../atomic.ts";
import { generateVapidKey, isPushService, PushSender, validPushKeys, vapidPublicKey, type PushKeys, type VapidKey } from "./web-push.ts";

const PUSH_CONTACT = "https://github.com/ihsieh31/alca-bots";
const MAX_TITLE_CHARS = 120;
const MAX_BODY_CHARS = 600;
const RETRY_DELAYS_MS = [2_000, 20_000];
const MAX_RETRY_AFTER_MS = 60_000;

const subscriptionSchema = z.object({
  endpoint: z.string().max(2048),
  keys: z.object({ p256dh: z.string().max(256), auth: z.string().max(64) }),
});
const savedSchema = z.record(z.string(), subscriptionSchema);
const vapidSchema = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string(), d: z.string() });

export class PushRefused extends Error {}

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  botId?: string;
  threadId?: string;
  groupId?: string;
}

const shorten = (text: string, limit: number) => {
  const chars = Array.from(text);
  return chars.length <= limit ? text : `${chars.slice(0, limit - 1).join("")}…`;
};

export function pushMessageFor(notification: Notification): PushMessage {
  const { kind, title, body, botName, botId, threadId, groupId } = notification;
  return {
    title: shorten(title || botName || "", MAX_TITLE_CHARS),
    body: shorten(body ?? "", MAX_BODY_CHARS),
    tag: `${kind}:${threadId ?? botId ?? ""}`,
    ...(botId ? { botId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

export interface LinkPushOptions {
  dir: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export class LinkPush {
  private readonly o: LinkPushOptions;
  private readonly subscriptionsFile: string;
  private readonly subscriptions: Map<string, { endpoint: string; keys: PushKeys }>;
  private key: VapidKey | null = null;
  private sender: PushSender | null = null;
  /** Open connections per phone and whether its page is on screen. */
  private readonly presence = new Map<string, { sessions: number; visible: boolean }>();

  constructor(o: LinkPushOptions) {
    this.o = o;
    this.subscriptionsFile = join(o.dir, "push-subscriptions.json");
    const saved = existsSync(this.subscriptionsFile) ? savedSchema.parse(JSON.parse(readFileSync(this.subscriptionsFile, "utf8"))) : {};
    this.subscriptions = new Map(Object.entries(saved));
  }

  private vapid(): VapidKey {
    if (this.key) return this.key;
    const file = join(this.o.dir, "push-vapid.json");
    if (existsSync(file)) {
      this.key = vapidSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    } else {
      this.key = generateVapidKey();
      writeFileAtomic(file, `${JSON.stringify(this.key)}\n`, { mode: 0o600 });
    }
    return this.key;
  }

  private save(): void {
    writeFileAtomic(this.subscriptionsFile, `${JSON.stringify(Object.fromEntries(this.subscriptions))}\n`, { mode: 0o600 });
  }

  config(deviceId: string): { publicKey: string; subscribed: boolean } {
    return { publicKey: vapidPublicKey(this.vapid()), subscribed: this.subscriptions.has(deviceId) };
  }

  subscribe(deviceId: string, input: unknown): void {
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success || !validPushKeys(parsed.data.keys)) throw new PushRefused("not a push subscription");
    if (!isPushService(parsed.data.endpoint)) throw new PushRefused("not a known push service");
    const held = this.subscriptions.get(deviceId);
    if (held?.endpoint === parsed.data.endpoint && held.keys.auth === parsed.data.keys.auth) return;
    this.subscriptions.set(deviceId, parsed.data);
    this.save();
  }

  remove(deviceId: string): void {
    if (this.subscriptions.delete(deviceId)) this.save();
    this.presence.delete(deviceId);
  }

  sessionOpened(deviceId: string): void {
    const now = this.presence.get(deviceId);
    this.presence.set(deviceId, { sessions: (now?.sessions ?? 0) + 1, visible: true });
  }

  sessionClosed(deviceId: string): void {
    const now = this.presence.get(deviceId);
    if (!now) return;
    if (now.sessions <= 1) this.presence.delete(deviceId);
    else now.sessions--;
  }

  setVisible(deviceId: string, visible: boolean): void {
    const now = this.presence.get(deviceId);
    if (now) now.visible = visible;
  }

  /** Reaches each subscribed phone that isn't showing the app right now, which already heard it over its connection. */
  notify(notification: Notification): void {
    const message = pushMessageFor(notification);
    for (const deviceId of this.subscriptions.keys()) {
      if (this.presence.get(deviceId)?.visible) continue;
      void this.deliver(deviceId, message);
    }
  }

  private async deliver(deviceId: string, message: PushMessage): Promise<void> {
    this.sender ??= new PushSender({ key: this.vapid(), contact: PUSH_CONTACT, ...(this.o.fetch ? { fetch: this.o.fetch } : {}) });
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref()));
    for (let attempt = 0; ; attempt++) {
      const target = this.subscriptions.get(deviceId);
      if (!target) return;
      const result = await this.sender.send(target, message);
      if (result.outcome === "sent") return;
      if (result.outcome === "gone") {
        // A new subscription may have replaced this one while the send was out.
        if (this.subscriptions.get(deviceId) === target) this.remove(deviceId);
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (result.outcome === "rejected" || delay === undefined) {
        this.o.log?.(`link: push not delivered (${result.status})`);
        return;
      }
      await sleep(Math.min(MAX_RETRY_AFTER_MS, Math.max(delay, (result.retryAfterSeconds ?? 0) * 1000)));
    }
  }
}
