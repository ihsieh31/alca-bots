// Starts the service worker and reports when a new version of the page is ready.
import { useSyncExternalStore } from "react";

import { SKIP_WAITING_MESSAGE } from "./sw-core";

const CONTROL_WAIT_MS = 1500;
const UPDATE_CHECK_MS = 30 * 60_000;

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function setWaiting(worker: ServiceWorker | null): void {
  if (worker === waiting) return;
  waiting = worker;
  for (const listener of listeners) listener();
}

function watch(registration: ServiceWorkerRegistration): void {
  const installingNow = () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
    });
  };
  if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
  installingNow();
  registration.addEventListener("updatefound", installingNow);

  let lastCheck = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
    lastCheck = Date.now();
    void registration.update().catch(() => {});
  });
}

/** Resolves once media requests can be answered, or soon anyway: the page still works without the worker. */
export async function startServiceWorker(): Promise<void> {
  const worker = navigator.serviceWorker;
  if (!worker || !import.meta.env.PROD) return;
  let registration: ServiceWorkerRegistration;
  try {
    registration = await worker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch {
    return;
  }
  watch(registration);
  void registration.update().catch(() => {});
  if (worker.controller) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, CONTROL_WAIT_MS);
    worker.addEventListener("controllerchange", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => waiting !== null);
}

export function applyUpdate(): void {
  const worker = waiting;
  if (!worker) return window.location.reload();
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  worker.postMessage({ type: SKIP_WAITING_MESSAGE });
}

/** A screen's code that an update has removed from the host: the only way to it is the new version. */
export function recoverFromMissingCode(): void {
  window.addEventListener("vite:preloadError", () => {
    try {
      if (sessionStorage.getItem("alca.reloadedForCode")) return;
      sessionStorage.setItem("alca.reloadedForCode", "1");
    } catch {
      return;
    }
    applyUpdate();
  });
}
