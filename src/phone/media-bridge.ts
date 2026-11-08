// The page's side of the service worker's requests: it fetches over the encrypted session and hands back what arrives.
import { MEDIA_MESSAGE, type MediaFromPage, type MediaRequest, type MediaToPage } from "./sw-core";

export function serveMedia(port: MessagePort, request: MediaRequest, fetchImpl: typeof fetch): void {
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;
  const send = (message: MediaFromPage, transfer: Transferable[] = []) => port.postMessage(message, transfer);

  const pull = async () => {
    if (!reader) return;
    try {
      const { done, value } = await reader.read();
      if (cancelled) return;
      if (done) {
        send({ t: "end" });
        port.close();
      } else {
        // A chunk may be a view on a buffer still in use, so only a whole buffer can be moved rather than copied.
        const whole = value.byteOffset === 0 && value.byteLength === value.buffer.byteLength;
        send({ t: "chunk", bytes: value }, whole ? [value.buffer] : []);
      }
    } catch {
      if (!cancelled) send({ t: "fail" });
      port.close();
    }
  };

  port.onmessage = ({ data }: MessageEvent<MediaToPage>) => {
    if (data.t === "pull") {
      void pull();
    } else {
      cancelled = true;
      abort.abort();
      void reader?.cancel().catch(() => {});
      port.close();
    }
  };

  void fetchImpl(request.url, { method: request.method, headers: request.headers, signal: abort.signal }).then((response) => {
    if (cancelled) {
      void response.body?.cancel().catch(() => {});
      return;
    }
    reader = response.body?.getReader() ?? null;
    send({ t: "head", status: response.status, headers: Array.from(response.headers.entries()) });
    if (!reader) {
      send({ t: "end" });
      port.close();
    }
  }).catch(() => {
    if (!cancelled) send({ t: "fail" });
    port.close();
  });
}

export function attachMediaBridge(fetchImpl: typeof fetch): void {
  const worker = navigator.serviceWorker;
  if (!worker) return;
  worker.addEventListener("message", (event: MessageEvent<{ type?: string } | null>) => {
    const port = event.ports[0];
    if (event.data?.type === MEDIA_MESSAGE && port) serveMedia(port, event.data as MediaRequest, fetchImpl);
  });
  // Messages wait for this when the listener isn't set through onmessage.
  worker.startMessages();
}
