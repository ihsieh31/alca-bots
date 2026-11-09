// Where a tapped notification wants to go. The service worker leaves it in storage before anything else, because a phone may
// start the app fresh, wake a suspended page or drop a message, and the target has to survive all three.
import { useEffect, useState } from "react";

import { OPEN_MESSAGE, PENDING_OPEN_CACHE, PENDING_OPEN_URL } from "../sw-core";

export interface OpenTarget {
  botId?: string;
  threadId?: string;
  groupId?: string;
}

const FIELDS = ["botId", "threadId", "groupId"] as const;
const PENDING_FOR_MS = 5 * 60_000;

/** A target left long ago, or by a tap the app never answered, must not pull the person away from what they're doing now. */
export function pendingTarget(record: unknown, now: number): OpenTarget | null {
  if (!record || typeof record !== "object") return null;
  const { at } = record as { at?: unknown };
  if (typeof at !== "number" || now - at > PENDING_FOR_MS) return null;
  const target: OpenTarget = {};
  for (const field of FIELDS) {
    const value = (record as Record<string, unknown>)[field];
    if (typeof value === "string" && value) target[field] = value;
  }
  return Object.keys(target).length ? target : null;
}

async function takePending(): Promise<OpenTarget | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(PENDING_OPEN_CACHE);
  const response = await cache.match(PENDING_OPEN_URL);
  if (!response) return null;
  await cache.delete(PENDING_OPEN_URL);
  return pendingTarget(await response.json().catch(() => null), Date.now());
}

export function useNotificationOpen(ready: boolean, open: (target: OpenTarget) => void): void {
  const [target, setTarget] = useState<OpenTarget | null>(null);

  useEffect(() => {
    const look = () => {
      void takePending().then((found) => { if (found) setTarget(found); }, () => {});
    };
    const heard = ({ data }: MessageEvent<{ type?: string }>) => {
      if (data?.type === OPEN_MESSAGE) look();
    };
    const shown = () => {
      if (document.visibilityState === "visible") look();
    };
    look();
    document.addEventListener("visibilitychange", shown);
    navigator.serviceWorker?.addEventListener("message", heard);
    return () => {
      document.removeEventListener("visibilitychange", shown);
      navigator.serviceWorker?.removeEventListener("message", heard);
    };
  }, []);

  useEffect(() => {
    if (!target || !ready) return;
    setTarget(null);
    open(target);
  }, [target, ready, open]);
}
