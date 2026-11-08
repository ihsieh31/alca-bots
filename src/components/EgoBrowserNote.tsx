import { Globe } from "lucide-react";

import { t } from "@/lib/i18n";

/** Bots browse in ego lite on the person's own computer, so the page is watched and taken over there, not here. */
export function EgoBrowserNote({ name }: { name: string }) {
  return (
    <div className="mt-2 flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-8 text-center" data-testid="ego-browser-note">
      <Globe size={22} className="text-ink-secondary" aria-hidden="true" />
      <div className="text-[14px] font-medium text-ink">{t("computer.egoBrowser.title")}</div>
      <p className="text-[12px] leading-5 text-ink-secondary">{t("computer.egoBrowser.body", { name })}</p>
    </div>
  );
}
