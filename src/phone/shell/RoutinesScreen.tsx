// A partner's scheduled work at a glance, with the one everyday control: on or off. Creating and editing happen on the computer.
import { useMemo } from "react";

import { t } from "@/lib/i18n";
import { scheduleLabel } from "@/lib/schedule-label";
import { cn } from "@/lib/cn";
import { useStore } from "@/state/store";
import { lightTap } from "./motion";
import { BackButton } from "./PhoneScreen";

export function RoutinesScreen({ onBack }: { onBack(): void }) {
  const { state, dispatch } = useStore();
  const routines = useMemo(() => [...state.routines].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)), [state.routines]);
  const nameOf = (botId: string) => state.bots.find((bot) => bot.id === botId)?.name;

  return (
    <div className="phone-chat phone-apps">
      <BackButton onBack={onBack} />
      <div className="phone-apps-scroll">
        <div className="phone-page phone-page-flush">
          <header className="phone-title"><h1>{t("phone.shell.scheduled")}</h1></header>
          {routines.length ? (
            <div className="phone-list">
              {routines.map((routine) => {
                const owner = nameOf(routine.botId);
                return (
                  <button
                    key={routine.id}
                    type="button"
                    role="switch"
                    aria-checked={routine.enabled}
                    className="phone-row w-full"
                    onClick={() => { lightTap(); dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } }); }}
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <span className="phone-row-title">{routine.name}</span>
                      <span className="phone-row-sub">{owner ? `${owner}・` : ""}{scheduleLabel(routine.schedule)}</span>
                    </span>
                    <span className={cn("phone-switch", routine.enabled && "phone-switch-on")} aria-hidden="true"><i /></span>
                  </button>
                );
              })}
            </div>
          ) : <p className="phone-empty-line">{t("phone.shell.routinesNone")}</p>}
          <p className="phone-footnote">{t("phone.shell.routinesHint")}</p>
        </div>
      </div>
    </div>
  );
}
