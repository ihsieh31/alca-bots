// The private ask for one connection's secrets (cloud-connections.mjs), which the one-time move (cloud-send.mjs)
// carries to the person's own Cloud.
//
// The secret leaves this computer's server only over Electron's private utility-process port (server/login-handoff.ts)
// and is answered only to the process it was asked of; nothing here keeps or logs it.
import { randomUUID } from "node:crypto";

const REQUEST = "alcabots:login-handoff";
const RESULT = "alcabots:login-handoff-result";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sentence = value => (typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null);

/** Main's half of the private ask: each answer is taken only from the server process it was asked of. */
export function createLoginHandoffClient({ timeoutMs = 10_000, randomId = randomUUID } = {}) {
  const pending = new Map();
  const settle = (requestId, action) => {
    const waiting = pending.get(requestId);
    if (!waiting) return;
    pending.delete(requestId);
    clearTimeout(waiting.timer);
    action(waiting);
  };
  return {
    request(proc, what) {
      if (!proc) return Promise.reject(new Error("AlcaBots on this computer is not running. Try again in a moment."));
      const requestId = randomId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settle(requestId, () => reject(new Error("AlcaBots on this computer did not answer. Try again."))), timeoutMs);
        timer.unref?.();
        pending.set(requestId, { proc, resolve, reject, timer });
        try { proc.postMessage({ type: REQUEST, requestId, what }); }
        catch { settle(requestId, () => reject(new Error("AlcaBots on this computer could not be asked. Try again."))); }
      });
    },
    /** True for a handoff answer, kept or ignored; never logs or throws with what it carried. */
    receive(proc, message) {
      if (!record(message) || message.type !== RESULT) return false;
      const waiting = typeof message.requestId === "string" ? pending.get(message.requestId) : undefined;
      if (!waiting || waiting.proc !== proc) return true;
      settle(message.requestId, ({ resolve, reject }) => {
        if (message.ok === true && [message.connection, message.share, message.release, message.secrets].some(record)) resolve(message);
        else reject(new Error(sentence(message.error) ?? "AlcaBots on this computer could not read that connection."));
      });
      return true;
    },
  };
}

