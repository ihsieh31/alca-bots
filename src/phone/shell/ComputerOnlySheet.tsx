// What the phone says wherever the shared app views offer a setting that lives on the computer.
import { t } from "@/lib/i18n";
import { lightTap } from "./motion";
import { Sheet } from "./Sheet";

export function ComputerOnlySheet({ title, onClose }: { title?: string; onClose(): void }) {
  return (
    <Sheet title={title ?? t("phone.shell.computerOnlyTitle")} onClose={onClose}>
      <p className="phone-sheet-note">{t("phone.shell.computerOnlyBody")}</p>
      <button type="button" className="phone-sheet-action phone-press" onClick={() => { lightTap(); onClose(); }}>
        {t("phone.shell.gotIt")}
      </button>
    </Sheet>
  );
}
