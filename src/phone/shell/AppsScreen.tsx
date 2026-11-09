// The apps this computer's partners can use, at a glance. Connecting and removing them happens on the computer.
import { useEffect, useState } from "react";

import { ServiceIcon, type ToolkitCard } from "@/components/ServiceIcon";
import { preloadConnectedApps } from "@/lib/connected-apps";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { BackButton } from "./PhoneScreen";

interface ConnectedApp {
  slug: string;
  card: Pick<ToolkitCard, "logo" | "domain" | "label">;
}

export function connectedApps(services: Record<string, { connected?: boolean }>, cards: readonly ToolkitCard[]): ConnectedApp[] {
  return Object.entries(services)
    .filter(([, service]) => service.connected)
    .map(([slug]) => ({ slug, card: cards.find((card) => card.slug === slug) ?? { label: slug, logo: null, domain: null } }))
    .sort((a, b) => a.card.label.localeCompare(b.card.label));
}

export function AppsScreen({ onBack }: { onBack(): void }) {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([preloadConnectedApps(true), api("/api/connectors/catalog")]).then(([inventory, catalog]) => {
      if (live) setApps(connectedApps(inventory.services, (catalog as { cards?: ToolkitCard[] }).cards ?? []));
    }, () => {
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, []);

  return (
    <div className="phone-chat phone-apps">
      <BackButton onBack={onBack} />
      <div className="phone-apps-scroll">
        <div className="phone-page phone-page-flush">
          <header className="phone-title"><h1>{t("phone.shell.apps")}</h1></header>
          {failed ? <p className="phone-empty-line">{t("phone.shell.appsFailed")}</p> : null}
          {apps && !apps.length ? <p className="phone-empty-line">{t("phone.shell.appsNone")}</p> : null}
          {apps?.length ? (
            <div className="phone-list">
              {apps.map(({ slug, card }) => (
                <div key={slug} className="phone-row">
                  <ServiceIcon card={card} className="size-10 shrink-0 rounded-[11px]" />
                  <span className="min-w-0 flex-1">
                    <span className="phone-row-title">{card.label}</span>
                    <span className="phone-row-sub">{t("phone.shell.appsConnected")}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="phone-footnote">{t("phone.shell.appsHint")}</p>
        </div>
      </div>
    </div>
  );
}
