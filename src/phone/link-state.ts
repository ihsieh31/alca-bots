// How the phone is reaching its computer right now, for whatever on the page wants to say so.
import { useSyncExternalStore } from "react";

export type LinkPath = "direct" | "relay" | "offline" | "connecting";

export interface LinkState {
  path: LinkPath;
  computer: string;
}

let current: LinkState = { path: "connecting", computer: "" };
const listeners = new Set<() => void>();

export function setLinkState(next: LinkState): void {
  if (next.path === current.path && next.computer === current.computer) return;
  current = next;
  for (const listener of listeners) listener();
}

export const linkPathFor = (via: string | null | undefined): LinkPath => (via === "relay" ? "relay" : via ? "direct" : "connecting");

export function useLinkState(): LinkState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => current);
}
