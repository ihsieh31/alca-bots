// EventSource for a page whose requests go over Link, where the browser's own EventSource can't reach. It keeps the
// standard's behaviour the app depends on: reconnecting with Last-Event-ID, and a refusal ending the stream for good.
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;
const DEFAULT_RETRY_MS = 3000;

export function createLinkEventSource(fetcher: typeof fetch, base: () => string) {
  return class LinkEventSource extends EventTarget {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSED = CLOSED;
    readonly CONNECTING = CONNECTING;
    readonly OPEN = OPEN;
    readonly CLOSED = CLOSED;
    readonly url: string;
    readonly withCredentials = false;
    readyState = CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    private lastEventId = "";
    private retryMs = DEFAULT_RETRY_MS;
    private readonly aborter = new AbortController();
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(url: string | URL) {
      super();
      this.url = new URL(String(url), base()).href;
      void this.connect();
    }

    close(): void {
      this.readyState = CLOSED;
      if (this.timer) clearTimeout(this.timer);
      this.aborter.abort();
    }

    private lost(): void {
      if (this.readyState === CLOSED) return;
      this.readyState = CONNECTING;
      this.announceError();
      if (this.readyState === CLOSED) return;
      this.timer = setTimeout(() => void this.connect(), this.retryMs);
    }

    private announceError(): void {
      const event = new Event("error");
      this.dispatchEvent(event);
      this.onerror?.(event);
    }

    private async connect(): Promise<void> {
      let response: Response;
      try {
        response = await fetcher(this.url, {
          headers: { accept: "text/event-stream", ...(this.lastEventId ? { "last-event-id": this.lastEventId } : {}) },
          signal: this.aborter.signal,
        });
      } catch {
        this.lost();
        return;
      }
      if (this.readyState === CLOSED) return;
      if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
        this.readyState = CLOSED;
        this.announceError();
        return;
      }
      this.readyState = OPEN;
      const opened = new Event("open");
      this.dispatchEvent(opened);
      this.onopen?.(opened);
      try {
        await this.read(response.body);
      } catch {
        // A cut stream is handled like its normal end.
      }
      this.lost();
    }

    private async read(body: ReadableStream<Uint8Array>): Promise<void> {
      const decoder = new TextDecoder();
      const reader = body.getReader();
      let buffer = "";
      let data: string[] = [];
      let type = "";
      let pendingId: string | null = null;
      const dispatch = () => {
        if (pendingId !== null) this.lastEventId = pendingId;
        pendingId = null;
        if (data.length) {
          const event = new MessageEvent(type || "message", { data: data.join("\n"), lastEventId: this.lastEventId, origin: new URL(this.url).origin });
          this.dispatchEvent(event);
          if (!type || type === "message") this.onmessage?.(event);
        }
        data = [];
        type = "";
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        // A trailing \r may be the first half of \r\n, so it waits for the next chunk.
        const lines = buffer.split(/\r\n|\n|\r(?!$)/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) {
            dispatch();
            continue;
          }
          if (line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const raw = colon < 0 ? "" : line.slice(colon + 1);
          const text = raw.startsWith(" ") ? raw.slice(1) : raw;
          if (field === "data") data.push(text);
          else if (field === "event") type = text;
          else if (field === "id" && !text.includes("\0")) pendingId = text;
          else if (field === "retry" && /^\d+$/.test(text)) this.retryMs = Number(text);
        }
      }
    }
  };
}
