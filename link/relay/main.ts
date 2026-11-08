// A self-hosted relay: matches pairing codes and forwards ciphertext. It stores nothing.
//
//   node --experimental-strip-types link/relay/main.ts [options]
//
//   --host <addr>        listen address (default 127.0.0.1; 0.0.0.0 to expose)   $ALCA_RELAY_HOST
//   --port <n>           default 8787                                             $ALCA_RELAY_PORT
//   --tls-cert <pem>     serve HTTPS/WSS directly (else run behind a TLS proxy)   $ALCA_RELAY_TLS_CERT
//   --tls-key <pem>                                                               $ALCA_RELAY_TLS_KEY
//   --site <dir>         also serve the built phone site from this directory      $ALCA_RELAY_SITE
//   --trust-proxy        client address from X-Forwarded-For (behind your proxy)  $ALCA_RELAY_TRUST_PROXY=1
//   --trust-proxy-hops <n>  how many proxies of yours append to X-Forwarded-For (default 1 with
//                        --trust-proxy): the client is the n-th entry from the right  $ALCA_RELAY_TRUST_PROXY=<n>
//   --origin <url>       allowed browser Origin (repeatable; default any)         $ALCA_RELAY_ORIGINS (comma list)
import { parseArgs } from "node:util";
import { startRelay } from "./server.ts";

const { values } = parseArgs({
  options: {
    host: { type: "string" },
    port: { type: "string" },
    "tls-cert": { type: "string" },
    "tls-key": { type: "string" },
    site: { type: "string" },
    "trust-proxy": { type: "boolean" },
    "trust-proxy-hops": { type: "string" },
    origin: { type: "string", multiple: true },
  },
});
const env = process.env;
const origins = values.origin ?? (env.ALCA_RELAY_ORIGINS ? env.ALCA_RELAY_ORIGINS.split(",") : []);
const cert = values["tls-cert"] ?? env.ALCA_RELAY_TLS_CERT;
const key = values["tls-key"] ?? env.ALCA_RELAY_TLS_KEY;
const site = values.site ?? env.ALCA_RELAY_SITE;
const hopsArg =
  values["trust-proxy-hops"] ??
  (/^\d+$/.test(env.ALCA_RELAY_TRUST_PROXY ?? "") ? env.ALCA_RELAY_TRUST_PROXY : undefined);
const trustProxy = hopsArg !== undefined ? Number(hopsArg) : (values["trust-proxy"] ?? false);
if (!Number.isInteger(Number(trustProxy)) || Number(trustProxy) < 0) {
  console.error("--trust-proxy-hops needs a whole number ≥ 0");
  process.exit(2);
}
const relay = await startRelay({
  host: values.host ?? env.ALCA_RELAY_HOST ?? "127.0.0.1",
  port: Number(values.port ?? env.ALCA_RELAY_PORT ?? 8787),
  ...(cert && key ? { tlsCert: cert, tlsKey: key } : {}),
  ...(site ? { siteDir: site } : {}),
  trustProxy,
  origins: origins.map((s) => s.trim()).filter(Boolean),
});
console.log(
  `AlcaBots relay on ${relay.url} (WebSocket ${relay.url.replace(/^http/, "ws")}/v0/link)${site ? ", phone site at /" : ""}`,
);
console.log("Stores nothing; forwards ciphertext only. Ctrl+C to stop.");
const stop = async () => {
  await relay.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
