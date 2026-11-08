// The phone's tab screens.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, CalendarClock, ChevronRight, FolderOpen, Palette, Plus, Puzzle, Settings2, Users, Wifi } from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { NewBotDialog } from "@/components/lazy-screens";
import { useLanguageChoice } from "@/lib/language-preference";
import { t } from "@/lib/i18n";
import { scheduleSentence } from "@/lib/schedule-label";
import { cn } from "@/lib/cn";
import { useStore, type Bot, type Group } from "@/state/store";
import { useLinkState } from "../link-state";
import { elapsedLabel, partnerStatus, partnersInOrder, todayView, type PartnerStatus, type ThreadRow } from "./derive";
import { lightTap } from "./motion";
import { NotificationsRow } from "./notifications";

function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

export function ScreenTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <header className="phone-title">
      <div className="min-w-0">
        {eyebrow ? <p className="phone-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="phone-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Pressable({ onPress, className, children, label }: { onPress(): void; className?: string; children: ReactNode; label?: string }) {
  return (
    <button type="button" aria-label={label} className={cn("phone-press", className)} onClick={() => { lightTap(); onPress(); }}>
      {children}
    </button>
  );
}

const dateLine = (now: number) => new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

function WaitingStack({ rows, bots, onOpen }: { rows: ThreadRow[]; bots: readonly Bot[]; onOpen(row: ThreadRow): void }) {
  const [open, setOpen] = useState(false);
  const collapsed = !open && rows.length > 1;
  return (
    <div className={cn("phone-stack", collapsed && "phone-stack-collapsed")} style={{ "--stack-count": Math.min(rows.length, 3) } as React.CSSProperties}>
      {rows.map((row, index) => {
        const bot = bots.find((candidate) => candidate.id === row.botId);
        return (
          <Pressable
            key={row.key}
            className="phone-decision"
            onPress={() => (collapsed ? setOpen(true) : onOpen(row))}
          >
            <span className="phone-decision-layer" style={{ "--layer": index } as React.CSSProperties}>
              {bot ? <BotAvatar bot={bot} size={40} /> : null}
              <span className="min-w-0 flex-1 text-left">
                <span className="phone-row-title">{row.name}</span>
                <span className="phone-row-sub">{row.title ?? t("phone.shell.needsYourDecision")}</span>
              </span>
              {collapsed && index === 0
                ? <span className="phone-count">{rows.length}</span>
                : <ChevronRight size={18} aria-hidden="true" className="shrink-0 opacity-40" />}
            </span>
          </Pressable>
        );
      })}
    </div>
  );
}

export function TodayScreen({ onOpenThread, onOpenChat }: { onOpenThread(row: ThreadRow): void; onOpenChat(id: string): void }) {
  const { state } = useStore();
  const view = useMemo(() => todayView(state), [state]);
  const now = useNow(view.working.length > 0);
  const quiet = !view.waiting.length && !view.working.length && !view.unread.length;
  const botById = (id: string) => state.bots.find((bot) => bot.id === id);
  const roster = useMemo(() => partnersInOrder(state.bots), [state.bots]);

  return (
    <div className="phone-page">
      <ScreenTitle eyebrow={dateLine(now)} title={t("phone.shell.today")} />
      {quiet && state.hydrated ? (
        <div className="phone-quiet">
          <p className="phone-quiet-title">{t("phone.shell.quietTitle")}</p>
          <p>{t("phone.shell.quietBody")}</p>
        </div>
      ) : null}
      {view.waiting.length ? (
        <Section title={t("phone.shell.waitingOnYou")}>
          <WaitingStack rows={view.waiting} bots={state.bots} onOpen={onOpenThread} />
        </Section>
      ) : null}
      {view.working.length ? (
        <Section title={t("phone.shell.inProgress")}>
          <div className="phone-list">
            {view.working.map((row) => {
              const bot = botById(row.botId);
              return (
                <Pressable key={row.key} className="phone-row" onPress={() => onOpenThread(row)}>
                  {bot ? <BotAvatar bot={bot} size={36} /> : null}
                  <span className="min-w-0 flex-1 text-left">
                    <span className="phone-row-title">{row.name}</span>
                    {row.title ? <span className="phone-row-sub">{row.title}</span> : null}
                  </span>
                  <span className="phone-live"><i />{row.startedAt ? elapsedLabel(row.startedAt, now) : t("phone.shell.working")}</span>
                </Pressable>
              );
            })}
          </div>
        </Section>
      ) : null}
      {view.unread.length ? (
        <Section title={t("phone.shell.newMessages")}>
          <div className="phone-list">
            {view.unread.map((row) => {
              const bot = botById(row.id);
              return (
                <Pressable key={row.key} className="phone-row" onPress={() => onOpenChat(row.id)}>
                  {bot ? <BotAvatar bot={bot} size={36} /> : <span className="phone-room-mark"><Users size={16} aria-hidden="true" /></span>}
                  <span className="phone-row-title min-w-0 flex-1 text-left">{row.name}</span>
                  <span className="phone-dot" aria-label={t("phone.shell.unread")} />
                </Pressable>
              );
            })}
          </div>
        </Section>
      ) : null}
      {roster.length ? (
        <Section title={t("phone.shell.partners")}>
          <div className="phone-roster">
            {roster.map((bot) => (
              <Pressable key={bot.id} className="phone-roster-item" onPress={() => onOpenChat(bot.id)}>
                <BotAvatar bot={bot} size={52} />
                <span>{bot.name}</span>
              </Pressable>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

const STATUS_WORDS: Record<PartnerStatus, Parameters<typeof t>[0]> = {
  waiting: "phone.shell.needsYourDecision",
  working: "phone.shell.working",
  idle: "phone.shell.available",
};

function PartnerRow({ bot, onOpen }: { bot: Bot; onOpen(): void }) {
  const status = partnerStatus(bot);
  return (
    <Pressable className="phone-row" onPress={onOpen}>
      <BotAvatar bot={bot} size={44} />
      <span className="min-w-0 flex-1 text-left">
        <span className="phone-row-title">{bot.name}</span>
        <span className={cn("phone-row-sub", status !== "idle" && "phone-row-sub-strong")}>{status === "idle" && bot.title ? bot.title : t(STATUS_WORDS[status])}</span>
      </span>
      {status === "working" ? <span className="phone-live"><i /></span> : bot.unread ? <span className="phone-dot" aria-label={t("phone.shell.unread")} /> : null}
    </Pressable>
  );
}

function RoomRow({ group, onOpen }: { group: Group; onOpen(): void }) {
  return (
    <Pressable className="phone-row" onPress={onOpen}>
      <span className="phone-room-mark"><Users size={18} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1 text-left">
        <span className="phone-row-title">{group.name}</span>
        <span className="phone-row-sub">{t("phone.shell.members", { count: group.memberIds.length })}</span>
      </span>
      {group.working ? <span className="phone-live"><i /></span> : group.unread ? <span className="phone-dot" aria-label={t("phone.shell.unread")} /> : null}
    </Pressable>
  );
}

export function PartnersScreen({ onOpenChat }: { onOpenChat(id: string): void }) {
  const { state } = useStore();
  const [adding, setAdding] = useState(false);
  const partners = useMemo(() => partnersInOrder(state.bots), [state.bots]);
  const rooms = state.groups.filter((group) => !group.dm);
  return (
    <div className="phone-page">
      <ScreenTitle
        title={t("phone.shell.partners")}
        action={<Pressable className="phone-round" label={t("phone.shell.addPartner")} onPress={() => setAdding(true)}><Plus size={20} aria-hidden="true" /></Pressable>}
      />
      <div className="phone-list">
        {partners.map((bot) => <PartnerRow key={bot.id} bot={bot} onOpen={() => onOpenChat(bot.id)} />)}
      </div>
      {rooms.length ? (
        <Section title={t("phone.shell.rooms")}>
          <div className="phone-list">
            {rooms.map((group) => <RoomRow key={group.id} group={group} onOpen={() => onOpenChat(group.id)} />)}
          </div>
        </Section>
      ) : null}
      {adding ? <NewBotDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function MenuRow({ icon, title, detail, onPress }: { icon: ReactNode; title: string; detail?: string; onPress(): void }) {
  return (
    <Pressable className="phone-row" onPress={onPress}>
      <span className="phone-menu-icon">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="phone-row-title">{title}</span>
        {detail ? <span className="phone-row-sub">{detail}</span> : null}
      </span>
      <ChevronRight size={18} aria-hidden="true" className="shrink-0 opacity-40" />
    </Pressable>
  );
}

export function WorkScreen({ onOpenThread, onShowRoutines, onShowFiles }: { onOpenThread(row: ThreadRow): void; onShowRoutines(): void; onShowFiles(): void }) {
  const { state } = useStore();
  const view = useMemo(() => todayView(state), [state]);
  const now = useNow(view.working.length > 0);
  const routines = state.routines.filter((routine) => routine.enabled).slice(0, 5);
  const botById = (id: string) => state.bots.find((bot) => bot.id === id);
  return (
    <div className="phone-page">
      <ScreenTitle title={t("phone.shell.work")} />
      <Section title={t("phone.shell.inProgress")}>
        {view.working.length ? (
          <div className="phone-list">
            {view.working.map((row) => {
              const bot = botById(row.botId);
              return (
                <Pressable key={row.key} className="phone-row" onPress={() => onOpenThread(row)}>
                  {bot ? <BotAvatar bot={bot} size={36} /> : null}
                  <span className="min-w-0 flex-1 text-left">
                    <span className="phone-row-title">{row.title ?? row.name}</span>
                    {row.title ? <span className="phone-row-sub">{row.name}</span> : null}
                  </span>
                  <span className="phone-live"><i />{row.startedAt ? elapsedLabel(row.startedAt, now) : ""}</span>
                </Pressable>
              );
            })}
          </div>
        ) : <p className="phone-empty-line">{t("phone.shell.nothingRunning")}</p>}
      </Section>
      <Section title={t("phone.shell.scheduled")}>
        <div className="phone-list">
          {routines.map((routine) => (
            <Pressable key={routine.id} className="phone-row" onPress={onShowRoutines}>
              <span className="phone-menu-icon"><CalendarClock size={18} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1 text-left">
                <span className="phone-row-title">{routine.name}</span>
                <span className="phone-row-sub">{scheduleSentence(routine.schedule)}</span>
              </span>
            </Pressable>
          ))}
          <MenuRow icon={<CalendarClock size={18} aria-hidden="true" />} title={t("phone.shell.allRoutines")} onPress={onShowRoutines} />
        </div>
      </Section>
      <Section title={t("phone.shell.library")}>
        <div className="phone-list">
          <MenuRow icon={<FolderOpen size={18} aria-hidden="true" />} title={t("files.title")} onPress={onShowFiles} />
        </div>
      </Section>
    </div>
  );
}

export function MoreScreen() {
  const { dispatch } = useStore();
  const link = useLinkState();
  useLanguageChoice();
  const path = link.path === "direct" ? t("phone.shell.pathDirect")
    : link.path === "relay" ? t("phone.shell.pathRelay")
    : link.path === "offline" ? t("phone.shell.pathOffline") : t("phone.shell.pathConnecting");
  return (
    <div className="phone-page">
      <ScreenTitle title={t("phone.shell.more")} />
      <div className="phone-computer">
        <span className="phone-computer-mark"><Wifi size={18} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="phone-row-title">{link.computer}</span>
          <span className="phone-row-sub">{path}</span>
        </span>
        <span className={cn("phone-signal", `phone-signal-${link.path}`)} aria-hidden="true" />
      </div>
      <Section title={t("phone.shell.thisPhone")}>
        <div className="phone-list">
          <NotificationsRow icon={<Bell size={18} aria-hidden="true" />} />
          <MenuRow icon={<Palette size={18} aria-hidden="true" />} title={t("settings.section.appearance")}
            onPress={() => dispatch({ type: "toggleAppSettings", open: true, section: "appearance" })} />
        </div>
      </Section>
      <Section title={t("phone.shell.thisComputer")}>
        <div className="phone-list">
          <MenuRow icon={<Settings2 size={18} aria-hidden="true" />} title={t("settings.title")}
            onPress={() => dispatch({ type: "toggleAppSettings", open: true })} />
          <MenuRow icon={<Puzzle size={18} aria-hidden="true" />} title={t("phone.shell.apps")}
            onPress={() => dispatch({ type: "togglePlugins", open: true })} />
        </div>
      </Section>
    </div>
  );
}
