import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readPushState, turnOffPush, turnOnPush, type PushState } from "../push";
import { lightTap } from "./motion";

const HINTS = {
  on: "phone.push.on",
  off: "phone.push.off",
  "needs-install": "phone.push.needsInstall",
  unsupported: "phone.push.unsupported",
  denied: "phone.push.denied",
} as const;

export function NotificationsRow({ icon }: { icon: ReactNode }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void readPushState().then((next) => { if (live) setState(next); }, () => { if (live) setState("unsupported"); });
    return () => { live = false; };
  }, []);

  const switchable = state === "on" || state === "off";
  const toggle = () => {
    if (!switchable || busy) return;
    lightTap();
    setBusy(true);
    setFailed(false);
    void (state === "on" ? turnOffPush() : turnOnPush()).then(setState, () => setFailed(true)).finally(() => setBusy(false));
  };

  return (
    <button type="button" className="phone-row w-full" role="switch" aria-checked={state === "on"} aria-disabled={!switchable} onClick={toggle}>
      <span className="phone-menu-icon">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="phone-row-title">{t("phone.shell.notifications")}</span>
        {state ? <span className="phone-row-sub">{t(failed ? "phone.push.failed" : HINTS[state])}</span> : null}
      </span>
      {switchable ? <span className={cn("phone-switch", state === "on" && "phone-switch-on", busy && "phone-switch-busy")} aria-hidden="true"><i /></span> : null}
    </button>
  );
}
