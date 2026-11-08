// A conversation on the phone: the app's own conversation views, with their side panels as full screens over them.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Monitor } from "lucide-react";

import { ChatView } from "@/components/ChatView";
import { GroupView } from "@/components/GroupView";
import { optionsCardRow } from "@/components/OptionsCardRow";
import { SecretRequestCard } from "@/components/SecretRequestCard";
import { SignInRequestCard } from "@/components/SignInRequestCard";
import { ConnectorCard } from "@/components/ConnectorCard";
import { EgoBrowserWatch } from "@/components/EgoBrowserNote";
import { ActivityPanel, BotSettingsDialog, ComputerPanel, InspectorPanel, RoomPanel } from "@/components/lazy-screens";
import { t } from "@/lib/i18n";
import { currentTaskBot, useStore, visibleMessages, type Bot, type Message } from "@/state/store";
import { BrowserWindow } from "./browser/BrowserWindow";
import { pendingCards } from "./derive";
import { lightTap } from "./motion";
import { BackButton } from "./PhoneScreen";
import { Sheet } from "./Sheet";

function PendingCard({ bot, message, threadId, transcript }: { bot: Bot; message: Message; threadId: string; transcript: readonly Message[] }) {
  if (message.secret) return <SecretRequestCard botId={bot.id} botName={bot.name} color={bot.color} threadId={threadId} message={message} />;
  if (message.signIn) return <SignInRequestCard botId={bot.id} botName={bot.name} color={bot.color} threadId={threadId} message={message} />;
  if (message.connector) return <ConnectorCard botId={bot.id} color={bot.color} threadId={threadId} message={message} />;
  return optionsCardRow({ message, transcript: transcript as Message[], botId: bot.id, botName: bot.name, botColor: bot.color, threadId });
}

/** Cards waiting on the person rise as a sheet once per card; closed, a pill above the composer brings them back. */
function DecisionSheet({ bot }: { bot: Bot }) {
  const messages = useMemo(() => visibleMessages(bot), [bot]);
  const pending = useMemo(() => pendingCards(messages), [messages]);
  const [closed, setClosed] = useState<string | null>(null);
  const [reopened, setReopened] = useState(false);
  const newest = pending[pending.length - 1]?.id ?? null;
  useEffect(() => setReopened(false), [newest]);
  if (!pending.length) return null;
  const open = reopened || closed !== newest;
  if (!open) {
    return (
      <button type="button" className="phone-decision-pill phone-press" onClick={() => { lightTap(); setReopened(true); }}>
        {t("phone.shell.decisionsWaiting", { count: pending.length })}
      </button>
    );
  }
  return (
    <Sheet title={t("phone.shell.needsYourDecision")} onClose={() => { setClosed(newest); setReopened(false); }}>
      <div className="flex flex-col gap-3">
        {pending.map((message) => <PendingCard key={message.id} bot={bot} message={message} threadId={bot.threadId} transcript={messages} />)}
      </div>
    </Sheet>
  );
}

export function ChatScreen({ onBack }: { onBack(): void }) {
  const { state, dispatch } = useStore();
  const [browserOpen, setBrowserOpen] = useState(false);
  const group = state.groups.find((candidate) => candidate.id === state.selectedId);
  const profile = group ? undefined : state.bots.find((candidate) => candidate.id === state.selectedId);
  const bot = profile ? currentTaskBot(profile) : undefined;
  const onScreen = bot?.busy && (bot.computer === "browser" || bot.computer === "local" || bot.computer === "vm" || bot.computer === "cloud");
  const openBrowser = useCallback(() => {
    lightTap();
    setBrowserOpen(true);
  }, []);
  return (
    <div data-phone-chat className="phone-chat">
      <BackButton onBack={onBack} />
      {group ? <GroupView key={group.id} group={group} /> : profile ? <ChatView bot={profile} /> : null}
      <div className="phone-pills">
        {bot && onScreen && !state.computerOpen ? (
          <button type="button" className="phone-live-pill phone-press" onClick={() => {
            lightTap();
            if (bot.computer === "browser") setBrowserOpen(true);
            else dispatch({ type: "toggleComputer", open: true });
          }}>
            <Monitor size={14} aria-hidden="true" /><i />{t("phone.shell.watchComputer")}
          </button>
        ) : null}
        {bot && !state.settingsOpen && !state.computerOpen ? <DecisionSheet bot={bot} /> : null}
      </div>
      {state.settingsOpen && profile ? <div className="phone-panel"><BotSettingsDialog key={`settings:${profile.id}`} bot={profile} overlay /></div> : null}
      {state.computerOpen && profile ? <div className="phone-panel"><EgoBrowserWatch.Provider value={openBrowser}><ComputerPanel key={`computer:${profile.id}`} bot={profile} onOpenVmWorkspace={() => {}} /></EgoBrowserWatch.Provider></div> : null}
      {state.inspectorOpen && profile ? <div className="phone-panel"><InspectorPanel key={profile.threadId} bot={profile} /></div> : null}
      {state.activityOpen && profile ? <div className="phone-panel"><ActivityPanel key={`activity:${profile.id}`} bot={profile} /></div> : null}
      {group && state.settingsOpen ? <div className="phone-panel"><RoomPanel key={`room:${group.id}`} group={group} overlay /></div> : null}
      {browserOpen && bot ? <BrowserWindow key={`browser:${bot.id}:${bot.threadId}`} botId={bot.id} botName={bot.name} threadId={bot.threadId} onClose={() => setBrowserOpen(false)} /> : null}
    </div>
  );
}
