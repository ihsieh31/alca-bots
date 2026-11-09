// The phone's page. It holds a pairing with one computer and moves the app's requests onto that connection, so the
// app itself runs unchanged.
import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { LinkClient, pairDevice, type LinkCredentials } from "../../link/src/client";
import { parseCode } from "../../link/src/handshake";
import type { Identity } from "../../link/src/identity";
import { w3cRtc } from "../../link/src/rtc";
import { parseLinkPairingFragment, type LinkPairingLink } from "../../shared/link";
import { PageBoundary } from "../components/PageBoundary";
import { bootstrapBrand, productName } from "../lib/brand";
import { applyChatWidth, readChatWidth } from "../lib/chat-width";
import { applyFont, readFont } from "../lib/fonts";
import { t } from "../lib/i18n";
import { settleAdvancedModeDefault } from "../lib/interface-mode";
import { loadPageLanguage } from "../lib/language-preference";
import { applySkinChoice } from "../lib/skins";
import "../styles.css";
import "./phone-colors.css";
import { createLinkEventSource } from "./event-source";
import { forgetCredentials, phoneIdentity, readCredentials, saveCredentials } from "./keystore";
import { LinkHttp } from "./link-http";
import { linkPathFor, setLinkRequest, setLinkState } from "./link-state";
import { attachMediaBridge } from "./media-bridge";
import { OfflineCache, OfflineFetch } from "./offline-cache";
import { forgetPush, isAppleTouch, isStandalone, reportVisibility, resyncPush } from "./push";
import { recoverFromMissingCode, startServiceWorker } from "./sw-client";

settleAdvancedModeDefault();
applySkinChoice("system");
applyFont(readFont());
applyChatWidth(readChatWidth());

const http = new LinkHttp({ nativeFetch: globalThis.fetch.bind(globalThis), origin: location.origin });
const offline = new OfflineFetch({ inner: http.fetch, connected: () => http.connected, origin: location.origin });
globalThis.fetch = offline.fetch;
globalThis.EventSource = createLinkEventSource(http.fetch, () => location.href) as unknown as typeof EventSource;
attachMediaBridge(http.fetch);
recoverFromMissingCode();

/** Taken from the address at once, so the code isn't left in the history or copied with the link. */
function takePairingLink(): LinkPairingLink | null {
  const link = parseLinkPairingFragment(location.hash);
  if (link) history.replaceState(null, "", location.pathname + location.search);
  return link;
}

/** The phone works without its offline copy, so a browser that won't store one just goes without. */
async function openOfflineCopy(deviceId: string): Promise<void> {
  offline.use(await OfflineCache.open(deviceId).catch(() => null));
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  return t("phone.thisBrowser");
}

const screen = "flex min-h-dvh items-center justify-center bg-app px-4 py-8 text-ink";
const card = "w-full max-w-[380px]";

/** iPhone home-screen apps keep their own storage: pairing in Safari would not carry over to the installed app. */
const needsHomeScreenFirst = () => isAppleTouch() && !isStandalone();

function PairScreen({ link, reason, onPaired }: { link: LinkPairingLink | null; reason: string | null; onPaired(credentials: LinkCredentials, identity: Identity): void }) {
  const [code, setCode] = useState(link?.code ?? "");
  const [relayUrl, setRelayUrl] = useState(link?.relayUrl ?? import.meta.env.VITE_LINK_RELAY_URL ?? location.origin);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      parseCode(code);
    } catch {
      setError(t("phone.pair.badCode"));
      setBusy(false);
      return;
    }
    try {
      const identity = await phoneIdentity();
      const credentials = await pairDevice({
        relayUrl,
        code,
        identity,
        device: { name: deviceName(), kind: "phone", platform: "web" },
        ...(link?.fingerprint ? { expectFingerprint: link.fingerprint } : {}),
      });
      await saveCredentials(credentials);
      await openOfflineCopy(credentials.deviceId);
      onPaired(credentials, identity);
    } catch {
      setError(t("phone.pair.failed"));
      setBusy(false);
    }
  };

  return (
    <main className={screen}>
      <form className={card} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h1 className="text-[22px] font-semibold">{t("phone.pair.title", { app: productName() })}</h1>
        <p className="mt-2 text-[14px] text-ink-secondary">{reason ?? t("phone.pair.intro")}</p>
        {needsHomeScreenFirst() ? <p className="mt-3 rounded-md bg-inset px-3 py-2 text-[13px] text-ink-secondary">{t("phone.pair.homeScreen")}</p> : null}
        <label className="mt-5 block text-[12px] font-medium text-ink-secondary" htmlFor="phone-code">{t("phone.pair.code")}</label>
        <input
          id="phone-code"
          className="mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-3 text-[18px] tracking-widest text-ink outline-none focus:border-accent"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="381-204-957"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        {custom ? (
          <>
            <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="phone-relay">{t("phone.pair.relay")}</label>
            <input id="phone-relay" className="mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent" inputMode="url" value={relayUrl} onChange={(event) => setRelayUrl(event.target.value)} />
          </>
        ) : null}
        {error ? <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p> : null}
        <button type="submit" disabled={busy || !code.trim()} className="mt-5 w-full rounded-md bg-accent px-4 py-3 text-[15px] font-medium text-accent-ink disabled:opacity-50">
          {busy ? t("phone.pair.connecting") : t("phone.pair.connect")}
        </button>
        {custom ? null : (
          <button type="button" className="mt-3 w-full text-[13px] text-ink-secondary underline" onClick={() => setCustom(true)}>{t("phone.pair.useOwnRelay")}</button>
        )}
      </form>
    </main>
  );
}

function Connected({ credentials, identity, onRemoved }: { credentials: LinkCredentials; identity: Identity; onRemoved(): void }) {
  const [app, setApp] = useState<ReactNode>(null);
  const [unreachable, setUnreachable] = useState(false);
  const loading = useRef(false);
  const mount = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    void import("./shell/PhoneApp").then(({ default: PhoneApp }) => setApp(<PhoneApp />));
  }, []);

  useEffect(() => {
    // With a copy of the app's state to draw, there's no reason to wait for the connection before showing it.
    if (offline.hasBootData()) mount();
    const factory = w3cRtc();
    const client = new LinkClient({ credentials, identity, moveGraceMs: 30_000, ...(factory ? { rtc: factory } : {}) });
    const computer = credentials.coreName;
    setLinkState({ path: "connecting", computer });
    const stopReady = client.onReady((_ready, peer) => {
      http.setPeer(peer, client.via);
      setLinkRequest((op, args) => peer.request(op, args));
      reportVisibility();
      void resyncPush().catch(() => {});
      setLinkState({ path: linkPathFor(client.via), computer });
      setUnreachable(false);
      mount();
    });
    const stopStatus = client.onStatus((status) => {
      if (status === "revoked") onRemoved();
      if (status === "offline") {
        http.setPeer(null);
        setLinkRequest(null);
        setLinkState({ path: "offline", computer });
        setUnreachable(true);
      }
    });
    const stopCredentials = client.onCredentials((next) => void saveCredentials(next));
    const resume = () => {
      reportVisibility();
      if (document.visibilityState === "visible") void client.resume();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void client.start();
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      stopReady();
      stopStatus();
      stopCredentials();
      client.stop();
      http.setPeer(null);
      setLinkRequest(null);
    };
  }, [credentials, identity, mount, onRemoved]);

  if (app) return app;
  return (
    <main className={screen}>
      <div role="status" className={`${card} text-center`}>
        <p className="text-[17px] font-medium">{unreachable ? t("phone.offline.title", { computer: credentials.coreName }) : t("phone.connecting", { computer: credentials.coreName })}</p>
        {unreachable ? <p className="mt-2 text-[14px] text-ink-secondary">{t("phone.offline.body")}</p> : null}
      </div>
    </main>
  );
}

function Phone({ initial, link }: { initial: { credentials: LinkCredentials; identity: Identity } | null; link: LinkPairingLink | null }) {
  const [paired, setPaired] = useState(link ? null : initial);
  const [reason, setReason] = useState<string | null>(null);
  const [removed] = useState(() => () => {
    void forgetCredentials();
    void forgetPush();
    void offline.forget();
    setPaired(null);
    setReason(t("phone.removed"));
  });
  if (!paired) return <PairScreen link={link} reason={reason} onPaired={(credentials, identity) => setPaired({ credentials, identity })} />;
  return <Connected credentials={paired.credentials} identity={paired.identity} onRemoved={removed} />;
}

async function boot(): Promise<void> {
  const link = takePairingLink();
  await startServiceWorker();
  const credentials = await readCredentials();
  const initial = credentials ? { credentials, identity: await phoneIdentity() } : null;
  if (credentials) await openOfflineCopy(credentials.deviceId);
  document.title = productName();
  await loadPageLanguage();
  createRoot(document.getElementById("root")!).render(<StrictMode><PageBoundary><Phone initial={initial} link={link} /></PageBoundary></StrictMode>);
  void bootstrapBrand();
}

void boot();
