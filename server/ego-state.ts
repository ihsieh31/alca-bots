// What the ego lite proxy and the server's live view share on disk: each bot's task spaces, and a person's hold on a
// bot's browser. The proxy runs as its own process per turn, so a file under the data folder is the meeting point.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The task spaces a bot used most recently, newest last. */
const KEEP_SPACES = 8;

export interface EgoHold {
  /** The person holding the bot's browser, as the live view names them. */
  by: string;
  until: number;
}

type Spaces = Record<string, number[]>;
type Holds = Record<string, EgoHold>;

const BOT_ID = /^[\w-]{1,120}$/u;

function readJson<T extends object>(path: string): T {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : {} as T;
  } catch {
    return {} as T;
  }
}

function writeJson(dir: string, name: string, value: object): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, path);
}

const spaceId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** Remembers spaces a bot's script used, newest last. */
export function recordBotSpaces(dir: string, botId: string, ids: readonly number[]): void {
  if (!BOT_ID.test(botId) || !ids.length) return;
  const all = readJson<Spaces>(join(dir, "spaces.json"));
  const kept = (Array.isArray(all[botId]) ? all[botId] : []).filter(spaceId).filter((id) => !ids.includes(id));
  all[botId] = [...kept, ...ids.filter(spaceId)].slice(-KEEP_SPACES);
  writeJson(dir, "spaces.json", all);
}

/** The bot's spaces, newest first. */
export function botSpaces(dir: string, botId: string): number[] {
  const ids = readJson<Spaces>(join(dir, "spaces.json"))[botId];
  return Array.isArray(ids) ? ids.filter(spaceId).reverse() : [];
}

export function setEgoHold(dir: string, botId: string, hold: EgoHold | null): void {
  if (!BOT_ID.test(botId)) return;
  const all = readJson<Holds>(join(dir, "holds.json"));
  if (hold) all[botId] = hold;
  else delete all[botId];
  writeJson(dir, "holds.json", all);
}

/** A hold still in force, or null. */
export function egoHold(dir: string, botId: string, now = Date.now()): EgoHold | null {
  const hold = readJson<Holds>(join(dir, "holds.json"))[botId];
  return hold && typeof hold.by === "string" && typeof hold.until === "number" && hold.until > now ? hold : null;
}

/** The ids a script's output names as `spaceId`, as ego lite's guide asks bots to print. */
export function printedSpaceIds(output: string): number[] {
  const ids = new Set<number>();
  for (const match of output.matchAll(/spaceId\W{0,4}(\d{1,9})/gu)) ids.add(Number(match[1]));
  return [...ids];
}
