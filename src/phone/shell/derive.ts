// What the phone's home screens show, worked out from the store's state.
import { botUnreadCount } from "@/lib/bot-unread";
import type { AppState, Bot, Message } from "@/state/store";

export interface ThreadRow {
  key: string;
  botId: string;
  threadId: string;
  name: string;
  /** The conversation's own title, when it isn't the bot's main one. */
  title?: string;
  startedAt?: number;
}

export interface UnreadRow {
  key: string;
  id: string;
  name: string;
  kind: "bot" | "room";
  count: number;
}

export interface TodayView {
  waiting: ThreadRow[];
  working: ThreadRow[];
  unread: UnreadRow[];
}

type TodayState = Pick<AppState, "bots" | "groups">;

const shownTasks = (bot: Bot) => (bot.tasks ?? []).filter((task) => !task.routineRunId && task.archivedAt === undefined);

function threadsWhere(bot: Bot, active: (entry: { activity?: Bot["activity"]; busy?: boolean }) => boolean): ThreadRow[] {
  const tasks = shownTasks(bot).filter(active);
  const rows: ThreadRow[] = tasks.map((task) => ({
    key: `${bot.id}:${task.threadId}`,
    botId: bot.id,
    threadId: task.threadId,
    name: bot.name,
    ...(task.threadId === bot.mainThreadId ? {} : { title: task.title }),
    ...(task.turnStartedAt ? { startedAt: task.turnStartedAt } : {}),
  }));
  if (!rows.length && active(bot)) {
    rows.push({
      key: `${bot.id}:${bot.threadId}`,
      botId: bot.id,
      threadId: bot.threadId,
      name: bot.name,
      ...(bot.turnStartedAt ? { startedAt: bot.turnStartedAt } : {}),
    });
  }
  return rows;
}

const isWaiting = (entry: { activity?: Bot["activity"] }) => entry.activity === "waiting-on-you";
const isWorking = (entry: { activity?: Bot["activity"]; busy?: boolean }) => entry.activity !== "waiting-on-you" && (entry.busy === true || entry.activity === "working");

export function todayView({ bots, groups }: TodayState): TodayView {
  const people = bots.filter((bot) => !bot.hidden);
  const waiting = people.flatMap((bot) => threadsWhere(bot, isWaiting));
  const waitingIds = new Set(waiting.map((row) => row.key));
  const working = people.flatMap((bot) => threadsWhere(bot, isWorking)).filter((row) => !waitingIds.has(row.key))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const unread: UnreadRow[] = [
    ...people.filter((bot) => botUnreadCount(bot) > 0 && !waiting.some((row) => row.botId === bot.id))
      .map((bot) => ({ key: bot.id, id: bot.id, name: bot.name, kind: "bot" as const, count: botUnreadCount(bot) })),
    ...groups.filter((group) => group.unread)
      .map((group) => ({ key: group.id, id: group.id, name: group.name, kind: "room" as const, count: 1 })),
  ];
  return { waiting, working, unread };
}

export type PartnerStatus = "waiting" | "working" | "idle";

export function partnerStatus(bot: Pick<Bot, "activity" | "busy" | "tasks">): PartnerStatus {
  const entries = [bot, ...(bot.tasks ?? [])];
  if (entries.some(isWaiting)) return "waiting";
  return entries.some(isWorking) ? "working" : "idle";
}

const STATUS_ORDER: Record<PartnerStatus, number> = { waiting: 0, working: 1, idle: 2 };

/** Who needs attention first, then who is pinned, then the order the person already keeps them in. */
export function partnersInOrder<T extends Pick<Bot, "activity" | "busy" | "tasks" | "pinned" | "hidden">>(bots: readonly T[]): T[] {
  return bots.filter((bot) => !bot.hidden)
    .map((bot, index) => ({ bot, index, status: STATUS_ORDER[partnerStatus(bot)] }))
    .sort((a, b) => a.status - b.status || Number(b.bot.pinned ?? false) - Number(a.bot.pinned ?? false) || a.index - b.index)
    .map((entry) => entry.bot);
}

/** The cards in a transcript still waiting on the person, oldest first. A tool's approval isn't one: the composer already
 * holds it within reach, in place of the keyboard. */
export function pendingCards(messages: readonly Message[]): Message[] {
  return messages.filter((message) => {
    if (message.secret) {
      const secret = message.secret;
      return !(secret.provided || secret.dismissed || secret.superseded || secret.stopped || secret.savedAt);
    }
    if (message.signIn) return !(message.signIn.done || message.signIn.cancelled || message.signIn.superseded);
    if (message.connector) return message.connector.status === "required" || message.connector.status === "authorizing";
    const card = message.card;
    return Boolean(card?.requestId && !card.tool && !card.answered && !card.expired && !card.autoApplied);
  });
}

/** Elapsed time as a phone shows it: "42s", "6m", "1h 20m". */
export function elapsedLabel(from: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${Math.floor(minutes / 60)}h`;
}
