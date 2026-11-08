// HTTP over a Link session: a paired device asks for harness routes and the bridge makes those requests on loopback
// under the device's own session, so request-auth judges them exactly as it judges any paired client.
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";

import { fromB64u, toB64u } from "../../link/src/bytes.ts";
import { RpcError } from "../../link/src/rpc.ts";
import {
  HTTP_CHANNEL,
  HTTP_CHUNK_BYTES,
  HTTP_MAX_STREAMS,
  HTTP_RELAY_BYTES_PER_SECOND,
  HTTP_WINDOW_BYTES,
  linkRequestRefusal,
  requestHeadersFor,
  responseHeadersFor,
  type HttpEvent,
} from "../../shared/link-http.ts";

export interface BridgePeer {
  emit(channel: string, event: unknown): void;
  onClose(handler: (reason: string) => void): void;
}

export interface BridgeOptions {
  /** Set while an organization forbids remote access: every request from a phone is refused until it lifts. */
  remoteAccessRefusal?(): string | undefined;
  peer: BridgePeer;
  /** Over the relay, replies are paced below its per-connection byte budget; a direct path is not. */
  overRelay: boolean;
  port: number;
  /** The device's session bearer, valid now. Never reaches the device: only the bridge adds it. */
  sessionToken(): string;
  now?: () => number;
}

interface Stream {
  request: ClientRequest;
  response?: IncomingMessage;
  unacked: number;
}

export type HttpOp = (args: Record<string, unknown>) => Promise<unknown> | unknown;

const STREAM_ID = /^[\w-]{1,40}$/;

const bad = (message: string) => new RpcError("bad_request", message);

function streamId(args: Record<string, unknown>): string {
  const id = args.id;
  if (typeof id !== "string" || !STREAM_ID.test(id)) throw bad("bad stream id");
  return id;
}

export function createHttpBridge(o: BridgeOptions): Record<string, HttpOp> {
  const streams = new Map<string, Stream>();
  const now = o.now ?? Date.now;
  let paceFreeAt = 0;
  const send = (event: HttpEvent) => o.peer.emit(HTTP_CHANNEL, event);

  const finish = (id: string, event?: HttpEvent) => {
    if (!streams.delete(id)) return;
    if (event) send(event);
  };

  const relayAllowance = async (bytes: number) => {
    if (!o.overRelay) return;
    const start = Math.max(now(), paceFreeAt);
    paceFreeAt = start + (bytes / HTTP_RELAY_BYTES_PER_SECOND) * 1000;
    const wait = start - now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };

  const pump = (id: string, stream: Stream, response: IncomingMessage) => {
    let sending = Promise.resolve();
    response.on("data", (data: Buffer) => {
      for (let at = 0; at < data.length; at += HTTP_CHUNK_BYTES) {
        const piece = data.subarray(at, at + HTTP_CHUNK_BYTES);
        stream.unacked += piece.length;
        sending = sending.then(() => relayAllowance(piece.length)).then(() => {
          if (streams.get(id) === stream) send({ id, t: "data", d: toB64u(piece) });
        });
      }
      if (stream.unacked >= HTTP_WINDOW_BYTES) response.pause();
    });
    response.on("end", () => {
      sending = sending.then(() => finish(id, { id, t: "end" }));
    });
    response.on("close", () => {
      if (!response.complete) sending = sending.then(() => finish(id, { id, t: "error", message: "the response ended early" }));
    });
  };

  o.peer.onClose(() => {
    for (const stream of streams.values()) stream.request.destroy();
    streams.clear();
  });

  return {
    "http.open": (args) => {
      const id = streamId(args);
      if (streams.has(id)) throw bad("stream id in use");
      if (streams.size >= HTTP_MAX_STREAMS) throw new RpcError("busy", "too many requests at once");
      const method = String(args.method ?? "").toUpperCase();
      const path = String(args.path ?? "");
      const refusal = linkRequestRefusal(method, path);
      if (refusal) throw new RpcError(refusal.code, refusal.message);
      const forbidden = o.remoteAccessRefusal?.();
      if (forbidden) throw new RpcError("forbidden", forbidden);
      const headers = {
        ...requestHeadersFor(args.headers),
        authorization: `Bearer ${o.sessionToken()}`,
      };
      const request = httpRequest({ host: "127.0.0.1", port: o.port, method, path, headers });
      const stream: Stream = { request, unacked: 0 };
      streams.set(id, stream);
      request.on("response", (response) => {
        stream.response = response;
        send({ id, t: "head", status: response.statusCode ?? 502, headers: responseHeadersFor(response.headers) });
        pump(id, stream, response);
      });
      request.on("error", () => finish(id, { id, t: "error", message: "the computer could not answer" }));
      if (args.body !== true) request.end();
      return {};
    },
    "http.body": async (args) => {
      const id = streamId(args);
      const stream = streams.get(id);
      if (!stream) throw new RpcError("gone", "no such request");
      const { request } = stream;
      if (typeof args.d === "string" && args.d) {
        const bytes = fromB64u(args.d);
        if (bytes.length > HTTP_CHUNK_BYTES) throw bad("chunk too large");
        if (!request.write(bytes)) {
          await new Promise<void>((resolve) => {
            const done = () => {
              request.off("drain", done);
              request.off("close", done);
              resolve();
            };
            request.once("drain", done);
            request.once("close", done);
          });
        }
      }
      if (args.end === true) request.end();
      return {};
    },
    "http.ack": (args) => {
      const stream = streams.get(streamId(args));
      const bytes = Number(args.bytes);
      if (!stream || !Number.isFinite(bytes) || bytes <= 0) return {};
      stream.unacked = Math.max(0, stream.unacked - bytes);
      if (stream.unacked < HTTP_WINDOW_BYTES && stream.response?.isPaused()) stream.response.resume();
      return {};
    },
    "http.cancel": (args) => {
      const id = streamId(args);
      const stream = streams.get(id);
      if (stream) {
        streams.delete(id);
        stream.request.destroy();
      }
      return {};
    },
  };
}
