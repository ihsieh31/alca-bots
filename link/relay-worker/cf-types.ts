// The few Cloudflare Workers runtime types this package uses (no dependency on @cloudflare/workers-types; shapes from
// developers.cloudflare.com).
export interface CfWebSocket {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", h: (e: { data: string | ArrayBuffer }) => void): void;
  addEventListener(type: "close" | "error", h: () => void): void;
  readonly readyState: number;
}

export interface DurableState {
  blockConcurrencyWhile<T>(f: () => Promise<T>): Promise<T>;
}

export interface DurableStub {
  fetch(req: Request): Promise<Response>;
}

export interface DurableNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableStub;
}

export interface RelayEnv {
  RELAY: DurableNamespace;
  /** Comma list of browser origins allowed to open a relay socket (the phone site). Required with RELAY_MODE. */
  ALLOWED_ORIGINS?: string;
  /**
   * `production` (the official deployment): refuse browser sockets while ALLOWED_ORIGINS is empty and report the
   * relay as not ok in /healthz. Anything else: a warning only.
   */
  RELAY_MODE?: string;
  /** Sockets this one Durable Object accepts (default 5000); past it, `relay is full`. */
  MAX_SOCKETS?: string;
}
