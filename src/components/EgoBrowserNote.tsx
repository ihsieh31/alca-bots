import { createContext, useContext } from "react";
import { Globe } from "lucide-react";

import { t } from "@/lib/i18n";

/** Where the phone opens its own view of the bot's browser; absent on the computer, which has ego lite itself. */
export const EgoBrowserWatch = createContext<(() => void) | null>(null);

/** Bots browse in ego lite on the person's own computer, so on that computer the page is watched and taken over there. */
export function EgoBrowserNote({ name }: { name: string }) {
  const watch = useContext(EgoBrowserWatch);
  return (
    <div className="mt-2 flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-8 text-center" data-testid="ego-browser-note">
      <Globe size={22} className="text-ink-secondary" aria-hidden="true" />
      <div className="text-[14px] font-medium text-ink">{t("computer.egoBrowser.title")}</div>
      {watch
        ? <button type="button" className="ui-button min-h-[44px] rounded-full px-5 text-[14px] font-medium" onClick={watch}>{t("phone.browser.watch")}</button>
        : <p className="text-[12px] leading-5 text-ink-secondary">{t("computer.egoBrowser.body", { name })}</p>}
    </div>
  );
}
