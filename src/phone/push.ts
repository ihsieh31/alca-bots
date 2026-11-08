// Notifications on this phone. The browser's push service delivers them, encrypted to this page, while the app is closed.
import { fromB64u } from "../../link/src/bytes.ts";
import { linkRequest } from "./link-state";

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

export const isAppleTouch = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);

export const isStandalone = (): boolean => matchMedia("(display-mode: standalone)").matches
  || (navigator as { standalone?: boolean }).standalone === true;

const hasPushApi = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && isSecureContext;

export function pushStateFrom(facts: { apple: boolean; standalone: boolean; api: boolean; permission: string; subscribed: boolean }): PushState {
  // A Safari tab has no push at all until it is on the Home Screen, so this comes before the check for the API.
  if (facts.apple && !facts.standalone) return "needs-install";
  if (!facts.api) return "unsupported";
  if (facts.permission === "denied") return "denied";
  return facts.subscribed && facts.permission === "granted" ? "on" : "off";
}

const subscription = async () => (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() ?? null;

const sameKey = (held: ArrayBuffer | null | undefined, wanted: Uint8Array) => {
  if (!held || held.byteLength !== wanted.length) return false;
  const bytes = new Uint8Array(held);
  return bytes.every((value, index) => value === wanted[index]);
};

export async function readPushState(): Promise<PushState> {
  const api = hasPushApi();
  return pushStateFrom({
    apple: isAppleTouch(),
    standalone: isStandalone(),
    api,
    permission: api ? Notification.permission : "default",
    subscribed: api ? Boolean(await subscription()) : false,
  });
}

/** Must start inside a tap, or the browser refuses to ask for permission. */
export async function turnOnPush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return readPushState();
  const { publicKey } = await linkRequest("push.config") as { publicKey: string };
  const key = fromB64u(publicKey);
  const registration = await navigator.serviceWorker.ready;
  let held = await registration.pushManager.getSubscription();
  // Made for another computer, whose pushes this one can't sign for.
  if (held && !sameKey(held.options.applicationServerKey, key)) {
    await held.unsubscribe().catch(() => {});
    held = null;
  }
  held ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(key) });
  await linkRequest("push.subscribe", held.toJSON() as Record<string, unknown>);
  return readPushState();
}

export async function turnOffPush(): Promise<PushState> {
  await (await subscription())?.unsubscribe().catch(() => {});
  await linkRequest("push.unsubscribe").catch(() => {});
  return readPushState();
}

/** A browser can replace a subscription on its own, and the computer only hears of it from the page. */
export async function resyncPush(): Promise<void> {
  if (!hasPushApi() || Notification.permission !== "granted") return;
  const held = await subscription();
  if (!held) return;
  const { publicKey } = await linkRequest("push.config") as { publicKey: string };
  if (sameKey(held.options.applicationServerKey, fromB64u(publicKey))) await linkRequest("push.subscribe", held.toJSON() as Record<string, unknown>);
}

export const forgetPush = async (): Promise<void> => {
  if (hasPushApi()) await (await subscription())?.unsubscribe().catch(() => {});
};

export function reportVisibility(): void {
  void linkRequest("push.visible", { visible: document.visibilityState === "visible" }).catch(() => {});
}
