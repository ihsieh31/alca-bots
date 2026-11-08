// `alcabots phone`: turns phone access on and shows a pairing code, for a computer nobody is sitting at.
import { encodeQr, qrTerminal } from "../link/src/qr.ts";
import type { LinkPairingView, LinkStatus } from "../shared/link.ts";

const READY_WAIT_MS = 15_000;
const POLL_MS = 500;

export interface PhonePairingDeps {
  log(line: string): void;
  error(line: string): void;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
}

const defaults: PhonePairingDeps = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
  fetch: globalThis.fetch,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

export async function runPhonePairing(port: number, options: { daily?: boolean }, deps: PhonePairingDeps = defaults): Promise<number> {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await deps.fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const answer = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(answer.error ?? `the server answered ${response.status}`);
    return answer;
  };
  try {
    await call<LinkStatus>("PATCH", "/api/link", { enabled: true });
    let status = await call<LinkStatus>("GET", "/api/link");
    for (let waited = 0; status.status !== "online" && waited < READY_WAIT_MS; waited += POLL_MS) {
      await deps.sleep(POLL_MS);
      status = await call<LinkStatus>("GET", "/api/link");
    }
    if (status.status !== "online") {
      deps.error(`This computer can't reach the relay at ${status.relayUrl}. Check its network, or set another with ALCA_LINK_RELAY_URL.`);
      return 1;
    }
    const pairing = await call<LinkPairingView>("POST", "/api/link/pairings", { access: options.daily ? "daily" : "full" });
    deps.log(qrTerminal(encodeQr(pairing.url)));
    deps.log(`Scan this with your phone's camera, or open ${status.siteUrl} and enter:`);
    deps.log("");
    deps.log(`    ${pairing.display}`);
    deps.log("");
    deps.log(`The code works once and expires at ${new Date(pairing.expiresAt).toLocaleTimeString()}. Keep it private.`);
    deps.log(options.daily ? "This phone gets daily use: conversations and tasks, no settings." : "This phone gets full access, the same as this computer. Use --daily for less.");
    return 0;
  } catch (error) {
    if (error instanceof TypeError) deps.error(`No AlcaBots server on http://127.0.0.1:${port}. Start one with \`alcabots serve\`, or set ALCA_PORT.`);
    else deps.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
