import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

/** Placeholder row replaced when push arrives. */
export function NotificationsRow({ icon }: { icon: ReactNode }) {
  return (
    <div className="phone-row">
      <span className="phone-menu-icon">{icon}</span>
      <span className="phone-row-title min-w-0 flex-1 text-left">{t("phone.shell.notifications")}</span>
    </div>
  );
}
