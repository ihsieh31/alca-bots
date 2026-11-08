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

type PeerRequest = (op: string, args?: Record<string, unknown>) => Promise<unknown>;

let peerRequest: PeerRequest | null = null;

export function setLinkRequest(request: PeerRequest | null): void {
  peerRequest = request;
}

/** Asks the computer something outside the app's own API. */
export function linkRequest(op: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return peerRequest ? peerRequest(op, args) : Promise.reject(new TypeError("not connected"));
}
