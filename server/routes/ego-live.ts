// GET /api/bots/<bot>/browser/live?threadId=… (server-sent events) and POST /api/bots/<bot>/browser/action: the v1 live
// view the phone apps speak, served from ego lite (ego-live.ts).
import { createHash } from "node:crypto";

import { EgoLiveError, type EgoLive } from "../ego-live.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const LIVE = /^\/api\/bots\/([\w-]+)\/browser\/(live|action)$/u;

export interface EgoLiveRouteDeps {
  live: EgoLive;
  /** Null when the view is offered; otherwise why not, such as a cloud home with no ego lite. */
  unavailable(): string | null;
  /** A member reaches a bot's browser only through a bot, or a thread of it, shown to them. */
  visible(auth: RequestAuth, botId: string, threadId: string | null): boolean;
}

/** Who is watching, as a name that is safe to keep on disk: a portal session's id is its membership grant. */
export function liveOwner(auth: RequestAuth): string {
  const who = auth.kind === "loopback"
    ? auth.companionDevice ? `phone:${auth.companionDevice}` : "local-owner"
    : auth.session.userId && !auth.session.userId.startsWith("portal:") ? `user:${auth.session.userId}` : `session:${auth.session.id}`;
  return createHash("sha256").update(who).digest("hex").slice(0, 24);
}

export function createEgoLiveRoutes(deps: EgoLiveRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const m = LIVE.exec(path);
    if (!m) return PASS;
    res.setHeader("cache-control", "no-store");
    const botId = m[1]!;
    const wanted = m[2] === "live" ? "GET" : "POST";
    if (method !== wanted) return json(res, 405, { error: "method not allowed" });
    if (!deps.visible(auth, botId, url.searchParams.get("threadId"))) return json(res, 404, { error: "no such conversation" });
    const refused = deps.unavailable();
    if (refused) return json(res, 503, { error: refused });
    const owner = liveOwner(auth);
    try {
      if (m[2] === "live") {
        req.socket.setTimeout(0);
        deps.live.open({ botId, owner, res });
        return;
      }
      const body = await readBody(req, 32_768);
      if (typeof body?.viewerId !== "string") return json(res, 400, { error: "A live browser connection is required." });
      return json(res, 200, await deps.live.action({ viewerId: body.viewerId, botId, owner, body }));
    } catch (error) {
      if (error instanceof EgoLiveError) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}
