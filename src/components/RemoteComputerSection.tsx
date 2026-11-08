import { useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { Laptop, Loader2 } from "lucide-react";
import { Card } from "./SettingsPrimitives";

const inputClass =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none";

function errorText(error: unknown): string {
  return String((error as { message?: string })?.message ?? error).replace(
    /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/,
    "",
  );
}

export function isServerPairingLink(input: string): boolean {
  const link = input.trim();
  if (!/^https:\/\//i.test(link) || /[\s\\]/.test(link)) return false;
  try {
    const url = new URL(link);
    const code = /(?:^|[#&])code=([^&]+)/.exec(url.hash)?.[1];
    return url.protocol === "https:" && !url.username && !url.password && !url.search
      && (url.pathname === "/pair" || url.pathname === "/pair/")
      && Boolean(code && decodeURIComponent(code).trim());
  } catch {
    return false;
  }
}

export function RemoteComputerSection({ hideWhenUnavailable = false }: { hideWhenUnavailable?: boolean }) {
  const environments = window.abot?.environments;
  const [serverLink, setServerLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const connect = async () => {
    if (pending.current || !environments) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (!isServerPairingLink(serverLink)) throw new Error(t("remote.client.server.invalidLink"));
      await environments.addFromLink(serverLink.trim());
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  if (!environments && hideWhenUnavailable) return null;

  return (
    <Card title={t("remote.client.idle")} subtitle={t("remote.client.subtitle")}>
      {!environments ? (
        <p className="text-[13px] text-ink-secondary">{t("remote.client.desktopOnly")}</p>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            {t("remote.client.server.hint")}
          </p>
          {/* A chat-only link cannot pass the ownership check behind "Make … my home", so full access comes first. */}
          <div data-pair-access="full" className="flex flex-col gap-1">
            <p className="text-[12px] font-medium text-ink">{t("remote.client.server.fullTitle")}</p>
            <code className="select-all rounded-lg bg-inset px-3 py-2 text-[12px] text-ink">npx alcabots pair</code>
          </div>
          <div data-pair-access="client" className="flex flex-col gap-1">
            <p className="text-[12px] font-medium text-ink">{t("remote.client.server.clientTitle")}</p>
            <code className="select-all rounded-lg bg-inset px-3 py-2 text-[12px] text-ink">npx alcabots pair --client</code>
            <p className="text-[12px] leading-relaxed text-ink-secondary">{t("remote.client.server.clientNote")}</p>
          </div>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">
            {t("remote.client.server.pairingLink")}
            <input
              value={serverLink}
              onChange={(event) => setServerLink(event.target.value)}
              placeholder="https://bots.example.com/pair#code=XXXX-XXXX-XXXX"
              disabled={busy}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </label>
          <p className="text-[12px] leading-relaxed text-ink-secondary">
            {t("remote.client.server.domainHint")}
          </p>
          {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
          <button
            type="submit"
            disabled={busy || !serverLink.trim()}
            className="flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Laptop size={14} />}
            {t("remote.client.server.connect")}
          </button>
          <p className="text-[12px] leading-relaxed text-ink-secondary">
            {t("remote.client.server.switchNote")}
          </p>
        </form>
      )}
    </Card>
  );
}
