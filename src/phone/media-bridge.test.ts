import { describe, expect, it, vi } from "vitest";

import { serveMedia } from "./media-bridge";
import { answerFromPage, MEDIA_MESSAGE, routeFor, type MediaRequest, type PageClients } from "./sw-core";

const clientsServing = (fetchImpl: typeof fetch): PageClients => {
  const client = {
    postMessage: (message: unknown, transfer: Transferable[]) => {
      serveMedia(transfer[0] as MessagePort, message as MediaRequest, fetchImpl);
    },
  };
  return { get: async () => client, matchAll: async () => [client] };
};

const request = (url: string, headers: Record<string, string> = {}, method = "GET") => ({ url, method, headers: new Headers(headers) });

describe("routeFor", () => {
  const origin = "https://phone.example";
  const precached = new Set(["/app-icon.svg"]);
  const route = (url: string, mode = "no-cors", method = "GET") => routeFor({ url, mode, method }, origin, precached);

  it("sends the computer's paths to the page, even when they are navigations such as a download", () => {
    expect(route(`${origin}/api/bots/1/avatar`)).toBe("page");
    expect(route(`${origin}/api/files/a.pdf`, "navigate")).toBe("page");
    expect(route(`${origin}/.well-known/alcabots/brand.json`)).toBe("page");
  });

  it("serves the shell and the build's files from the cache", () => {
    expect(route(`${origin}/`, "navigate")).toBe("shell");
    expect(route(`${origin}/assets/a-1.js`)).toBe("cached");
    expect(route(`${origin}/app-icon.svg`)).toBe("cached");
  });

  it("leaves everything else to the network", () => {
    expect(route("https://other.example/api/x")).toBe("network");
    expect(route(`${origin}/api/x`, "cors", "POST")).toBe("network");
    expect(route(`${origin}/link/ws`)).toBe("network");
  });
});

describe("answerFromPage", () => {
  it("carries a range request and a partial answer through intact", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: { "content-range": "bytes 0-2/10", "content-type": "video/mp4" },
    }));
    const response = await answerFromPage(request("https://phone.example/api/v.mp4", { range: "bytes=0-2", cookie: "no" }), "c", clientsServing(fetchImpl));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-2/10");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.headers).toEqual([["range", "bytes=0-2"]]);
  });

  it("reads the source only as fast as the body is read", async () => {
    let produced = 0;
    const source = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        produced++;
        controller.enqueue(new Uint8Array([produced]));
        if (produced === 50) controller.close();
      },
    }, { highWaterMark: 0 });
    const response = await answerFromPage(request("https://phone.example/api/big"), "c", clientsServing(async () => new Response(source)));
    const reader = response.body!.getReader();
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(produced).toBeLessThan(5);
    await reader.cancel();
  });

  it("aborts the page's fetch when the reader goes away", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(1)) }));
    };
    const response = await answerFromPage(request("https://phone.example/api/big"), "c", clientsServing(fetchImpl));
    await response.body!.cancel();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("gives empty answers no body", async () => {
    const response = await answerFromPage(request("https://phone.example/api/x", { "if-none-match": "a" }), "c", clientsServing(async () => new Response(null, { status: 304 })));
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
  });

  it("answers 502 when the page can't reach the computer", async () => {
    const response = await answerFromPage(request("https://phone.example/api/x"), "c", clientsServing(async () => { throw new TypeError("Failed to fetch"); }));
    expect(response.status).toBe(502);
  });

  it("answers 503 with no page open", async () => {
    const response = await answerFromPage(request("https://phone.example/api/x"), "", { get: async () => null, matchAll: async () => [] });
    expect(response.status).toBe(503);
  });

  it("answers 504 when the page never answers", async () => {
    const silent = { postMessage: vi.fn() };
    const response = await answerFromPage(request("https://phone.example/api/x"), "c", { get: async () => silent, matchAll: async () => [silent] }, 10);
    expect(response.status).toBe(504);
    expect((silent.postMessage.mock.calls[0]![0] as MediaRequest).type).toBe(MEDIA_MESSAGE);
  });

  it("falls back to any open page when the request has no owner", async () => {
    const owned = vi.fn(async () => null);
    const page = clientsServing(async () => new Response("ok"));
    const response = await answerFromPage(request("https://phone.example/api/x"), "", { get: owned, matchAll: page.matchAll });
    expect(owned).not.toHaveBeenCalled();
    expect(await response.text()).toBe("ok");
  });
});
