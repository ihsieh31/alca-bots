import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { LINK_DEFAULT_ICE_SERVERS, type LinkAccess, type LinkDeviceView, type LinkStatus } from "../../shared/link";
import { t } from "@/lib/i18n";
import { revealPhonePairing } from "@/lib/phone-pairing";
import { api } from "@/state/api";
import { Card, Switch } from "./SettingsPrimitives";

const POLL_MS = 2000;

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export function connectionLabel(connection: LinkDeviceView["connection"]): string {
  if (!connection) return t("phone.settings.notConnected");
  return connection === "relay" ? t("phone.settings.viaRelay") : t("phone.settings.direct");
}

export function serviceLabel(status: LinkStatus["status"]): string {
  if (status === "online") return t("phone.settings.ready");
  if (status === "off") return t("phone.settings.off");
  return t("phone.settings.reconnecting");
}

const secondsLeft = (expiresAt: string, now: number) => Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));

/** `focusRequest` counts the requests to show pairing: each new one scrolls here and focuses the connect button. */
export function PhoneAccessSection({ focusRequest = 0 }: { focusRequest?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [access, setAccess] = useState<LinkAccess>("full");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [relayDraft, setRelayDraft] = useState<string | null>(null);
  const [siteDraft, setSiteDraft] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await api<LinkStatus>("/api/link"));
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void refresh().catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("phone.settings.failed"));
    } finally {
      setBusy(false);
    }
  };

  const loaded = status !== null;
  useEffect(() => {
    if (focusRequest && loaded) revealPhonePairing(root.current);
  }, [focusRequest, loaded]);

  if (!status) return null;
  const on = status.enabled;
  const pairing = status.pairing;
  const left = pairing ? secondsLeft(pairing.expiresAt, now) : 0;
  const open = pairing?.state === "open" && left > 0;
  const direct = status.iceServers.length > 0;
  const field = "mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";

  return (
    <div ref={root} tabIndex={-1} className="outline-none">
    <Card title={t("phone.settings.title")} subtitle={t("phone.settings.subtitle")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">{t("phone.settings.allow")}</div>
          <div role="status" className="mt-0.5 text-[12px] text-ink-secondary">{serviceLabel(status.status)}</div>
        </div>
        <Switch
          checked={on}
          disabled={busy}
          aria-label={t("phone.settings.allow")}
          onClick={() => void act(() => api("/api/link", jsonInit("PATCH", { enabled: !on })))}
        />
      </div>

      {on ? (
        <div className="mt-4 border-t border-hairline/30 pt-4">
          {open ? (
            <div className="flex flex-col items-center text-center">
              <div className="rounded-lg bg-white p-2">
                <QRCodeSVG value={pairing.url} size={200} level="M" bgColor="#ffffff" fgColor="#111111" />
              </div>
              <p className="mt-3 text-[13px] text-ink-secondary">{t("phone.settings.scan")}</p>
              <p className="mt-2 font-mono text-[22px] font-semibold tracking-widest text-ink">{pairing.display}</p>
              <p className="mt-1 text-[12px] text-ink-secondary">{t("phone.settings.expires", { minutes: Math.floor(left / 60), seconds: String(left % 60).padStart(2, "0") })}</p>
              <p className="mt-1 break-all text-[12px] text-ink-secondary">{status.siteUrl}</p>
              <button type="button" className="mt-3 text-[13px] text-ink-secondary underline" onClick={() => void act(() => api(`/api/link/pairings/${pairing.nameplate}`, jsonInit("DELETE")))}>
                {t("phone.settings.cancel")}
              </button>
            </div>
          ) : (
            <>
              {pairing?.state === "paired" ? <p role="status" className="mb-3 text-[13px] text-ink">{t("phone.settings.paired", { name: pairing.deviceName ?? "" })}</p> : null}
              <fieldset>
                <legend className="text-[12px] font-medium text-ink-secondary">{t("phone.settings.accessTitle")}</legend>
                {(["full", "daily"] as const).map((choice) => (
                  <label key={choice} className="mt-2 flex cursor-pointer items-start gap-2 text-[13px] text-ink">
                    <input type="radio" name="phone-access" className="mt-0.5" checked={access === choice} onChange={() => setAccess(choice)} />
                    <span>
                      {t(choice === "full" ? "phone.settings.accessFull" : "phone.settings.accessDaily")}
                      <span className="block text-[12px] text-ink-secondary">{t(choice === "full" ? "phone.settings.accessFullHint" : "phone.settings.accessDailyHint")}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                data-phone-pairing-action
                disabled={busy || status.status !== "online"}
                className="mt-4 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50"
                onClick={() => void act(() => api("/api/link/pairings", jsonInit("POST", { access })))}
              >
                {t("phone.settings.connect")}
              </button>
            </>
          )}
        </div>
      ) : null}

      {status.devices.length ? (
        <ul className="mt-4 border-t border-hairline/30 pt-2">
          {status.devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] text-ink">{device.name}</div>
                <div className="text-[12px] text-ink-secondary">
                  {t(device.access === "full" ? "phone.settings.accessFull" : "phone.settings.accessDaily")} · {connectionLabel(device.connection)}
                </div>
              </div>
              <button type="button" disabled={busy} className="shrink-0 text-[13px] text-danger disabled:opacity-50" onClick={() => void act(() => api(`/api/link/devices/${device.id}`, jsonInit("DELETE")))}>
                {t("phone.settings.remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="mt-4 border-t border-hairline/30 pt-3">
        <summary className="cursor-pointer text-[13px] text-ink-secondary">{t("phone.settings.advanced")}</summary>
        <p className="mt-2 text-[12px] text-ink-secondary">{t("phone.settings.relayExplain")}</p>
        <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
          {t("phone.settings.relay")}
          <input
            className={field}
            value={relayDraft ?? status.relayUrl}
            onChange={(event) => setRelayDraft(event.target.value)}
            onBlur={() => {
              if (relayDraft === null || relayDraft === status.relayUrl) return setRelayDraft(null);
              void act(() => api("/api/link", jsonInit("PATCH", { relayUrl: relayDraft }))).finally(() => setRelayDraft(null));
            }}
          />
        </label>
        <label className="mt-3 block text-[12px] font-medium text-ink-secondary">
          {t("phone.settings.site")}
          <input
            className={field}
            value={siteDraft ?? status.siteUrl}
            onChange={(event) => setSiteDraft(event.target.value)}
            onBlur={() => {
              if (siteDraft === null || siteDraft === status.siteUrl) return setSiteDraft(null);
              void act(() => api("/api/link", jsonInit("PATCH", { siteUrl: siteDraft }))).finally(() => setSiteDraft(null));
            }}
          />
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] text-ink">{t("phone.settings.directTitle")}</div>
            <div className="mt-0.5 text-[12px] text-ink-secondary">{t("phone.settings.directExplain")}</div>
          </div>
          <Switch
            checked={direct}
            disabled={busy}
            aria-label={t("phone.settings.directTitle")}
            onClick={() => void act(() => api("/api/link", jsonInit("PATCH", { iceServers: direct ? [] : LINK_DEFAULT_ICE_SERVERS })))}
          />
        </div>
        {status.fingerprint ? <p className="mt-3 break-all font-mono text-[11px] text-ink-secondary">{status.fingerprint}</p> : null}
      </details>

      {error || status.error ? <p role="alert" className="mt-3 text-[12px] text-danger">{error ?? status.error}</p> : null}
    </Card>
    </div>
  );
}
