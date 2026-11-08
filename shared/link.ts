// The wire types of /api/link, the computer's side of connecting phones.

/** `full` is everything the computer's owner can do; `daily` is the client scope only. */
export type LinkAccess = "full" | "daily";

export const LINK_DEFAULT_RELAY_URL = "https://bots-relay.alca-corp.me";
export const LINK_DEFAULT_SITE_URL = "https://bots-app.alca-corp.me";
/** STUN operators learn both ends' public addresses and when they connect: the settings page says so. */
export const LINK_DEFAULT_ICE_SERVERS: readonly string[] = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

export interface LinkSettings {
  /** Off until the owner turns it on: only then does this computer connect out to a relay. */
  enabled: boolean;
  relayUrl: string;
  siteUrl: string;
  /** Empty means no direct connection: everything goes through the relay. */
  iceServers: string[];
}

export interface LinkDeviceView {
  id: string;
  name: string;
  access: LinkAccess;
  createdAt: number;
  lastSeenAt: number;
  connection: "relay" | "rtc" | "lan" | null;
}

export interface LinkPairingView {
  nameplate: string;
  /** The code a person types, like `381-204-957`. */
  display: string;
  expiresAt: string;
  access: LinkAccess;
  /** The site link with the code in its fragment, which no page host ever receives. */
  url: string;
  state: "open" | "paired" | "failed";
  error?: string;
  deviceName?: string;
}

export interface LinkStatus extends LinkSettings {
  status: "off" | "offline" | "connecting" | "online" | "closed";
  fingerprint: string | null;
  devices: LinkDeviceView[];
  pairing: LinkPairingView | null;
  /** What keeps the service from starting, such as a settings problem. */
  error: string | null;
}

/** The link a phone opens to pair. Everything travels in the fragment: a page host never receives it. */
export function linkPairingUrl(input: { siteUrl: string; code: string; fingerprint: string; relayUrl: string }): string {
  const fragment = new URLSearchParams({ pair: input.code, fp: input.fingerprint, pk: "2", r: input.relayUrl });
  return `${input.siteUrl.replace(/\/+$/, "")}/#${fragment}`;
}

export interface LinkPairingLink {
  code: string;
  fingerprint?: string;
  relayUrl?: string;
}

export function parseLinkPairingFragment(hash: string): LinkPairingLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("pair")?.replace(/\D/g, "");
  if (!code || code.length < 9 || code.length > 10) return null;
  const fingerprint = params.get("fp") ?? undefined;
  const relayUrl = params.get("r") ?? undefined;
  return { code, ...(fingerprint ? { fingerprint } : {}), ...(relayUrl ? { relayUrl } : {}) };
}
