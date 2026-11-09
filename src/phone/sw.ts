// The phone site's service worker. It keeps the page openable with no network and answers media requests through the
// page's connection. A new version waits until the person chooses to update, so a page isn't swapped under them.
import { answerFromPage, OPEN_MESSAGE, PENDING_OPEN_CACHE, PENDING_OPEN_URL, routeFor, SKIP_WAITING_MESSAGE, type PageClient } from "./sw-core";

declare const __SW_VERSION__: string;
declare const __SW_PRECACHE__: string[];

interface WaitEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface FetchEvent extends WaitEvent {
  request: Request;
  clientId: string;
  respondWith(answer: Promise<Response>): void;
}
interface PushEvent extends WaitEvent {
  data: { json(): unknown } | null;
}
interface NotificationClickEvent extends WaitEvent {
  notification: { data: unknown; close(): void };
}
interface WindowClient extends PageClient {
  focus(): Promise<unknown>;
}
const sw = self as unknown as {
  location: Location;
  clients: {
    get(id: string): Promise<WindowClient | undefined | null>;
    matchAll(options: { type: "window"; includeUncontrolled: true }): Promise<readonly WindowClient[]>;
    claim(): Promise<void>;
    openWindow(url: string): Promise<unknown>;
  };
  registration: { showNotification(title: string, options: Record<string, unknown>): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: WaitEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  addEventListener(type: "push", listener: (event: PushEvent) => void): void;
  addEventListener(type: "notificationclick", listener: (event: NotificationClickEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent<{ type?: string } | null>) => void): void;
};

const CACHE = `alca-shell-${__SW_VERSION__}`;
const SHELL = "/";
const precached = new Set(__SW_PRECACHE__);

sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(__SW_PRECACHE__)));
});

sw.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("alca-shell-") && name !== CACHE).map((name) => caches.delete(name)));
    await sw.clients.claim();
  })());
});

sw.addEventListener("message", (event) => {
  if (event.data?.type === SKIP_WAITING_MESSAGE) void sw.skipWaiting();
});

async function cachedOrFetched(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function shell(request: Request): Promise<Response> {
  const hit = await (await caches.open(CACHE)).match(SHELL);
  return hit ?? fetch(request);
}

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  const route = routeFor(request, sw.location.origin, precached);
  if (route === "page") event.respondWith(answerFromPage(request, event.clientId, sw.clients));
  else if (route === "shell") event.respondWith(shell(request));
  else if (route === "cached") event.respondWith(cachedOrFetched(request));
});

interface PushMessage {
  title?: unknown;
  body?: unknown;
  tag?: unknown;
  botId?: unknown;
  threadId?: unknown;
  groupId?: unknown;
}

sw.addEventListener("push", (event) => {
  let message: PushMessage = {};
  try {
    message = (event.data?.json() ?? {}) as PushMessage;
  } catch {
    // Still shown: a browser takes away push from a page that receives one and shows nothing.
  }
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  event.waitUntil(sw.registration.showNotification(text(message.title) ?? "AlcaBot", {
    body: text(message.body) ?? "",
    tag: text(message.tag),
    icon: "/app-icon-192.png",
    badge: "/app-icon-192.png",
    data: { botId: text(message.botId), threadId: text(message.threadId), groupId: text(message.groupId) },
  }));
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data ?? {}) as Record<string, string | undefined>;
  event.waitUntil((async () => {
    const pending = await caches.open(PENDING_OPEN_CACHE);
    await pending.put(PENDING_OPEN_URL, new Response(JSON.stringify({ ...target, at: Date.now() })));
    const [page] = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (page) {
      const focused = await page.focus().then(() => true, () => false);
      page.postMessage({ type: OPEN_MESSAGE }, []);
      if (focused) return;
    }
    await sw.clients.openWindow(SHELL);
  })());
});
