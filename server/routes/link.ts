// The computer's page for phone access: whether it is on, which relay it uses, a pairing code, the paired phones.
import { RpcError } from "../../link/src/rpc.ts";
import type { LinkAccess } from "../../shared/link.ts";
import type { LinkService } from "../link/service.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const ONE_PAIRING = /^\/api\/link\/pairings\/(\d{1,8})$/;
const ONE_DEVICE = /^\/api\/link\/devices\/([\w-]{1,64})$/;

const STATUS_FOR: Record<string, number> = { bad_request: 400, offline: 409 };

export function linkRoutes(service: LinkService): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/link" && !path.startsWith("/api/link/")) return PASS;
    if (!ownerOrAdmin(auth)) {
      json(res, 403, { error: "Only the computer's owner can manage phones." });
      return;
    }
    try {
      if (path === "/api/link" && method === "GET") {
        json(res, 200, service.status());
        return;
      }
      if (path === "/api/link" && method === "PATCH") {
        json(res, 200, await service.update(await readBody(req)));
        return;
      }
      if (path === "/api/link/pairings" && method === "POST") {
        const body = await readBody(req) as { access?: unknown };
        const access: LinkAccess = body?.access === "daily" ? "daily" : "full";
        json(res, 200, await service.createPairing(access));
        return;
      }
      const pairing = method === "DELETE" ? path.match(ONE_PAIRING) : null;
      if (pairing) {
        service.cancelPairing(pairing[1]!);
        json(res, 200, { ok: true });
        return;
      }
      const device = method === "DELETE" ? path.match(ONE_DEVICE) : null;
      if (device) {
        json(res, service.revokeDevice(device[1]!) ? 200 : 404, { ok: true });
        return;
      }
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      json(res, STATUS_FOR[error.code] ?? 500, { error: error.message });
      return;
    }
    return PASS;
  };
}
