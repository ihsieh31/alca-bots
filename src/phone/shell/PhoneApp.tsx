// The app as a phone shows it: its store and conversation views, in a shell made for one hand.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Layers, MoreHorizontal, Sparkles, Users } from "lucide-react";

import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { ChatNotice } from "@/components/ChatErrorBanner";
import { CloudAddDialog } from "@/components/lazy-screens";
import { LiveCallHost } from "@/components/LiveCallHost";
import { PhoneShell } from "@/components/phone-menu";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { WorkspaceBackupRecovery } from "@/components/WorkspaceBackupSettings";
import { useDesktopNotificationOpens, useExternalChatLinks } from "@/hooks/use-external-chat-links";
import { usePresence } from "@/hooks/use-presence";
import { useAiSwitchKeeper } from "@/lib/ai-switch";
import { botUnreadCount, showBrowserUnread } from "@/lib/bot-unread";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { effectiveLanguage, useLanguageChoice, usePageLanguage } from "@/lib/language-preference";
import { useShowThreads } from "@/lib/thread-preferences";
import { inboxVersion, useInboxLoader } from "@/state/inbox";
import { openBot, openThread, StoreProvider, useStore } from "@/state/store";
import { useTeamChats } from "@/state/team-chats";
import { needsYouVersion, useTeamPeopleLoader } from "@/state/team-people";
import { useLinkState } from "../link-state";
import { applyUpdate, useUpdateReady } from "../sw-client";
import { AppsScreen } from "./AppsScreen";
import { ChatScreen } from "./ChatScreen";
import { ComputerOnlySheet } from "./ComputerOnlySheet";
import { todayView, type ThreadRow } from "./derive";
import { lightTap } from "./motion";
import { useNotificationOpen, type OpenTarget } from "./notification-open";
import { usePhoneNav, type PhoneRoute, type PhoneTab } from "./nav";
import { PhoneScreen } from "./PhoneScreen";
import { RoutinesScreen } from "./RoutinesScreen";
import { MoreScreen, PartnersScreen, TodayScreen, WorkScreen } from "./screens";
import { useTabPager } from "./tab-pager";
import { useKeyboardInset } from "./use-keyboard-inset";
import "./phone.css";

const TABS: Array<{ id: PhoneTab; icon: typeof Sparkles; label: Parameters<typeof t>[0] }> = [
  { id: "today", icon: Sparkles, label: "phone.shell.today" },
  { id: "partners", icon: Users, label: "phone.shell.partners" },
  { id: "work", icon: Layers, label: "phone.shell.work" },
  { id: "more", icon: MoreHorizontal, label: "phone.shell.more" },
];

const TAB_IDS = TABS.map((entry) => entry.id);

function TabBar({ tab, badge, barRef, handlers, onSelect }: {
  tab: PhoneTab;
  badge: number;
  barRef: React.Ref<HTMLElement>;
  handlers: ReturnType<typeof useTabPager>["barHandlers"];
  onSelect(tab: PhoneTab): void;
}) {
  return (
    <nav ref={barRef} className="phone-tabs" aria-label={t("phone.shell.navigation")} style={{ "--tab-count": TABS.length } as React.CSSProperties} {...handlers}>
      <span className="phone-tab-indicator" aria-hidden="true" />
      {TABS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          aria-current={id === tab ? "page" : undefined}
          className="phone-tab"
          onClick={() => { if (id !== tab) { lightTap(); onSelect(id); } }}
        >
          <span className="relative">
            <Icon size={21} strokeWidth={id === tab ? 2.1 : 1.7} aria-hidden="true" />
            {id === "today" && badge > 0 ? <span className="phone-tab-badge">{badge}</span> : null}
          </span>
          <span>{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}

/** Says when the computer can't be reached or the app has lost its server; nothing while all is well. */
function ConnectionLine({ offline }: { offline: boolean }) {
  const link = useLinkState();
  return (
    <div className={cn("phone-connection", offline && "phone-connection-shown")} role="status" aria-hidden={!offline}>
      <span>{offline ? t("phone.shell.reconnecting", { computer: link.computer }) : ""}</span>
    </div>
  );
}

function UpdatePill() {
  const ready = useUpdateReady();
  const [applying, setApplying] = useState(false);
  if (!ready) return null;
  return (
    <button type="button" className="phone-update-pill" disabled={applying} onClick={() => { lightTap(); setApplying(true); applyUpdate(); }}>
      {t(applying ? "phone.shell.updating" : "phone.shell.updateReady")}
    </button>
  );
}

function Screen({ route, onBack }: { route: PhoneRoute; onBack(): void }) {
  if (route.kind === "chat") return <ChatScreen onBack={onBack} />;
  if (route.kind === "routines") return <RoutinesScreen onBack={onBack} />;
  return <AppsScreen onBack={onBack} />;
}

function Shell() {
  const { state, dispatch } = useStore();
  const nav = usePhoneNav();
  const showThreads = useShowThreads();
  useKeyboardInset();
  useTeamChats(state.config);
  const needsYou = needsYouVersion(state.bots, state.groups, state.notifications);
  useTeamPeopleLoader(state.config, needsYou);
  useInboxLoader(`${inboxVersion(state.bots) ?? ""}|${needsYou}`);
  useAiSwitchKeeper({ bots: state.bots, dispatch });
  useExternalChatLinks(state, dispatch);
  useDesktopNotificationOpens(state, dispatch);
  usePresence(state, dispatch);
  usePageLanguage(effectiveLanguage(useLanguageChoice(), state.config?.language), true);

  const unread = state.bots.filter((bot) => !bot.hidden).reduce((sum, bot) => sum + botUnreadCount(bot), 0)
    + state.groups.filter((group) => group.unread).length;
  useEffect(() => showBrowserUnread(unread), [unread]);

  // A screen stays the same mounted element while it plays its way out, so it leaves from where the finger let go of it.
  const screens = useRef<Array<{ id: number; route: PhoneRoute; leaving: boolean }>>([]);
  const serial = useRef(0);
  const [, screenGone] = useReducer((count: number) => count + 1, 0);
  const staying = screens.current.filter((entry) => !entry.leaving);
  for (const entry of staying.slice(nav.stack.length)) entry.leaving = true;
  for (const route of nav.stack.slice(staying.length)) screens.current.push({ id: ++serial.current, route, leaving: false });

  // The home screens aren't a conversation on screen, so a reply arriving there stays unread.
  const atHome = nav.stack.length === 0;
  useEffect(() => {
    if (atHome && state.activeView !== "phone-home") dispatch({ type: "phoneHome" });
  }, [atHome, state.activeView, dispatch]);

  const openChat = useCallback((id: string) => {
    const bot = state.bots.find((candidate) => candidate.id === id);
    if (bot) openBot(dispatch, bot, showThreads);
    else dispatch({ type: "select", id });
    nav.push({ kind: "chat" });
  }, [dispatch, nav, showThreads, state.bots]);
  const openRow = useCallback((row: ThreadRow) => {
    openThread(dispatch, { botId: row.botId, threadId: row.threadId }, state, showThreads);
    nav.push({ kind: "chat" });
  }, [dispatch, nav, showThreads, state]);

  const atChat = nav.stack[nav.stack.length - 1]?.kind === "chat";
  const openFromNotification = useCallback(({ botId, threadId, groupId }: OpenTarget) => {
    if (groupId) dispatch({ type: "select", id: groupId });
    else if (botId && threadId) openThread(dispatch, { botId, threadId }, state, showThreads);
    else if (botId) dispatch({ type: "select", id: botId });
    else return;
    if (!atChat) nav.push({ kind: "chat" });
  }, [atChat, dispatch, nav, showThreads, state]);
  useNotificationOpen(Boolean(state.hydrated), openFromNotification);

  const link = useLinkState();
  const offline = link.path === "offline" || (link.path === "connecting" && !state.connected);
  const waiting = todayView(state).waiting.length;
  const pushed = nav.stack.length > 0;
  const { pager, bar, barHandlers } = useTabPager(TAB_IDS, nav.tab, nav.selectTab);
  const showRoutines = () => { dispatch({ type: "showRoutines" }); nav.push({ kind: "routines" }); };
  const pages: Record<PhoneTab, React.ReactNode> = {
    today: <TodayScreen onOpenThread={openRow} onOpenChat={openChat} />,
    partners: <PartnersScreen onOpenChat={openChat} />,
    work: <WorkScreen onOpenThread={openRow} onShowRoutines={showRoutines} />,
    more: <MoreScreen onShowApps={() => nav.push({ kind: "apps" })} />,
  };

  return (
    <div data-phone-shell data-pushed={pushed ? "" : undefined} data-offline={offline ? "" : undefined} className="phone-shell">
      <ConnectionLine offline={offline} />
      <UpdatePill />
      <div className="phone-base">
        <div ref={pager} className="phone-pager">
          {TAB_IDS.map((id) => (
            <div key={id} className="phone-tab-page" inert={id !== nav.tab}>
              {id === nav.tab && state.notice ? <div className="px-5 pt-3"><ChatNotice notice={state.notice} /></div> : null}
              {pages[id]}
            </div>
          ))}
        </div>
        <TabBar tab={nav.tab} badge={waiting} barRef={bar} handlers={barHandlers} onSelect={nav.selectTab} />
        <div className="phone-base-dim" aria-hidden="true" />
      </div>
      {screens.current.map(({ id, route, leaving }) => (
        <PhoneScreen
          key={id}
          leaving={leaving}
          onBack={nav.back}
          onGone={() => { screens.current = screens.current.filter((entry) => entry.id !== id); screenGone(); }}
        >
          <Screen route={route} onBack={nav.back} />
        </PhoneScreen>
      ))}
      {state.appSettingsOpen ? <ComputerOnlySheet onClose={() => dispatch({ type: "toggleAppSettings", open: false })} /> : null}
      {state.pluginsOpen ? <ComputerOnlySheet onClose={() => dispatch({ type: "togglePlugins", open: false })} /> : null}
      {state.cloudAdd ? <CloudAddDialog /> : null}
    </div>
  );
}

export default function PhoneApp() {
  return (
    <WorkspaceBackupRecovery>
      <DesktopCapabilitiesProvider>
        <StoreProvider>
          <ThreadRefsProvider>
            <PhoneShell.Provider value>
              <Shell />
            </PhoneShell.Provider>
          </ThreadRefsProvider>
          <LiveCallHost />
        </StoreProvider>
      </DesktopCapabilitiesProvider>
    </WorkspaceBackupRecovery>
  );
}
