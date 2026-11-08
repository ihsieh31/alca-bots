// The v1 live view (GET …/browser/live as server-sent events, POST …/browser/action) that the phone apps speak, served
// from ego lite: a bot's task space is watched by polling screenshots through `ego-browser nodejs`, and a person who
// takes control drives it with ego lite's Page API while the bot's own browser scripts wait (ego-state.ts holds).
// The events and actions keep the v1 names, fields and limits, so a phone built against v1 works unchanged.
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type { ServerResponse } from "node:http";

import type { EgoRun } from "./ego-browser.ts";
import { botSpaces, egoHold, setEgoHold } from "./ego-state.ts";

const MAX_FRAME = 3 * 1024 * 1024;
const VIEWERS_TOTAL = 8;
const VIEWERS_PER_PERSON = 2;
const POLL_MS = 700;
const IDLE_POLL_MS = 3_000;
const HEARTBEAT_MS = 10_000;
const UNACKED_MS = 5_000;
const HOLD_MS = 10 * 60_000;
const RUN_MS = 20_000;
const MARK = "@@EGO_LIVE@@";
const SHOT_FILE = /^ego-browser-shot-[\w-]{1,64}\.png$/u;
const TAB_ID = /^t[1-9]\d{0,8}$/u;

export class EgoLiveError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

type Json = Record<string, unknown>;

export type LiveAction =
  | { type: "take" | "release" | "restart" | "resize" }
  | { type: "ack"; seq: number }
  | { type: "dialog"; accept: boolean; promptText?: string }
  | { type: "goto"; url: string }
  | { type: "history"; delta: -1 | 1 }
  | { type: "reload" }
  | { type: "tabNew"; url?: string }
  | { type: "tabSelect" | "tabClose"; tabId: string }
  | { type: "inputs"; inputs: LiveInput[] };

export type LiveInput =
  | { kind: "click"; x: number; y: number; count: number }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "text"; text: string }
  | { kind: "key"; chord: string };

const object = (value: unknown): Json | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
const number = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && number(value, min, max);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const invalid = () => new EgoLiveError("Invalid browser action.", 400);

/** An address a viewer may show: a web page's, never its credentials. */
export function displayUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:", "about:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return "";
  }
}

function pageUrl(value: unknown): string {
  if (!text(value, 8192)) throw invalid();
  // eslint-disable-next-line no-control-regex -- Reject control characters before URL parsing normalizes them.
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value)) throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) throw invalid();
  return url.href;
}

/** CDP's modifier bits, as the v1 viewer sends them, in Playwright's chord names. */
const MODIFIERS: ReadonlyArray<readonly [number, string]> = [[1, "Alt"], [2, "Control"], [4, "Meta"], [8, "Shift"]];

function input(body: Json): LiveInput | null {
  if (body.type === "input_mouse") {
    if (!["mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"].includes(String(body.eventType))
        || !number(body.x, 0, 8192) || !number(body.y, 0, 8192)) throw invalid();
    const clickCount = body.clickCount ?? 0, deltaX = body.deltaX ?? 0, deltaY = body.deltaY ?? 0;
    if (!integer(clickCount, 0, 3) || !number(deltaX, -10000, 10000) || !number(deltaY, -10000, 10000)) throw invalid();
    if (body.eventType === "mouseWheel") return { kind: "wheel", x: body.x, y: body.y, deltaX, deltaY };
    return body.eventType === "mousePressed" ? { kind: "click", x: body.x, y: body.y, count: Math.max(1, clickCount) } : null;
  }
  if (body.type === "input_keyboard") {
    if (body.eventType === "char") {
      if (!text(body.text, 4096) || !body.text) throw invalid();
      return { kind: "text", text: body.text };
    }
    if (!["keyDown", "keyUp"].includes(String(body.eventType)) || !text(body.key, 64) || !body.key) throw invalid();
    const modifiers = body.modifiers ?? 0;
    if (!integer(modifiers, 0, 15)) throw invalid();
    if (body.eventType === "keyUp") return null;
    const held = MODIFIERS.filter(([bit]) => (modifiers & bit) !== 0).map(([, name]) => name);
    // A printable key arrives again as its char event, which types it.
    if (body.key.length === 1 && !held.some((name) => name === "Control" || name === "Meta" || name === "Alt")) return null;
    return { kind: "key", chord: [...held.filter((name) => name !== body.key), body.key].join("+") };
  }
  throw invalid();
}

/** HTTP bodies select a fixed action, never a script. */
export function parseLiveAction(value: unknown): LiveAction {
  const body = object(value);
  if (!body || typeof body.type !== "string") throw invalid();
  switch (body.type) {
    case "take": case "release": case "restart": case "resize":
      return { type: body.type };
    case "ack":
      if (!integer(body.seq, 1, Number.MAX_SAFE_INTEGER)) throw invalid();
      return { type: "ack", seq: body.seq };
    case "dialog":
      if (typeof body.accept !== "boolean" || (body.promptText !== undefined && !text(body.promptText, 4096))) throw invalid();
      return { type: "dialog", accept: body.accept, ...(body.promptText === undefined ? {} : { promptText: body.promptText }) };
    case "back": case "forward":
      return { type: "history", delta: body.type === "back" ? -1 : 1 };
    case "reload":
      return { type: "reload" };
    case "navigate":
      return { type: "goto", url: pageUrl(body.url) };
    case "tab-new":
      return body.url === undefined ? { type: "tabNew" } : { type: "tabNew", url: pageUrl(body.url) };
    case "tab-select": case "tab-close":
      if (typeof body.tabId !== "string" || !TAB_ID.test(body.tabId)) throw invalid();
      return { type: body.type === "tab-select" ? "tabSelect" : "tabClose", tabId: body.tabId };
    case "input_batch": {
      if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 64) throw invalid();
      return { type: "inputs", inputs: body.events.map((event) => input(object(event) ?? {})).filter((step): step is LiveInput => step !== null) };
    }
    default: {
      const step = input(body);
      return { type: "inputs", inputs: step ? [step] : [] };
    }
  }
}

/** Resumes the newest of the bot's spaces that still exists; the ids are numbers, embedded as JSON. */
function resume(ids: readonly number[]): string {
  return `const ids = ${JSON.stringify(ids)};
let task = null;
for (const id of ids) { try { task = await taskSpace(id); break; } catch {} }
`;
}

export function pollScript(ids: readonly number[]): string {
  return `${resume(ids)}if (!task) { console.log(${JSON.stringify(MARK)} + JSON.stringify({ space: null })); } else {
  const tabs = await task.tabs();
  const active = tabs.find((tab) => tab.active) ?? tabs[0];
  const info = active ? await active.page.info().catch(() => null) : null;
  const shot = active ? await active.page.screenshot({ raw: true, scale: "css" }).catch(() => null) : null;
  console.log(${JSON.stringify(MARK)} + JSON.stringify({ space: task.spaceId, info, shot,
    tabs: tabs.map((tab) => ({ targetId: tab.targetId, title: tab.title, url: tab.url, active: tab.active })) }));
}`;
}

/** Runs one action on the bot's space as the person; the action is data, embedded as JSON. */
export function actionScript(ids: readonly number[], action: Json): string {
  return `${resume(ids)}if (!task) throw new Error("This bot has no browser open in ego lite.");
const action = ${JSON.stringify(action)};
const tabs = await task.tabs();
const pageOf = async (tab) => tab.label ? task.page(tab.label) : await task.adopt(tab.page);
const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
const page = activeTab ? await pageOf(activeTab) : null;
const target = action.targetId ? tabs.find((tab) => tab.targetId === action.targetId) : null;
if (action.targetId && !target) throw new Error("That tab is closed.");
if (!page && action.type !== "tabNew") throw new Error("This bot has no page open in ego lite.");
switch (action.type) {
  case "goto": await page.goto(action.url); break;
  case "history": await page.evaluate((delta) => history.go(delta), action.delta); break;
  case "reload": await page.reload(); break;
  case "dialog": if (action.accept) await page.acceptDialog(action.promptText); else await page.dismissDialog(); break;
  case "tabNew": { const created = await task.newPage(); if (action.url) await created.goto(action.url); break; }
  case "tabSelect": await task.cdp("Target.activateTarget", { targetId: target.targetId }); break;
  case "tabClose": await (await pageOf(target)).close(); break;
  case "inputs":
    for (const step of action.inputs) {
      if (step.kind === "click") { for (let i = 0; i < step.count; i++) await page.mouse.click(step.x, step.y); }
      else if (step.kind === "wheel") { await page.mouse.move(step.x, step.y); await page.mouse.wheel(step.deltaX, step.deltaY); }
      else if (step.kind === "text") await page.keyboard.insertText(step.text);
      else await page.keyboard.press(step.chord);
    }
    break;
}
console.log(${JSON.stringify(MARK)} + "{}");`;
}

interface Polled {
  space: number | null;
  info?: { url?: unknown; w?: unknown; h?: unknown; sx?: unknown; sy?: unknown } | null;
  shot?: unknown;
  tabs?: Array<{ targetId?: unknown; title?: unknown; url?: unknown; active?: unknown }>;
}

function marked(output: string): Json | null {
  const line = output.split("\n").reverse().find((row) => row.startsWith(MARK));
  if (!line) return null;
  try { return object(JSON.parse(line.slice(MARK.length))); } catch { return null; }
}

interface Viewer {
  id: string;
  botId: string;
  owner: string;
  res: ServerResponse;
  seq: number;
  sent: { seq: number; at: number } | null;
  frame: string;
  url: string;
  tabs: string;
  status: string;
  control: string;
  heartbeat: ReturnType<typeof setInterval>;
}

interface Watch {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  tabIds: Map<string, string>;
  nextTab: number;
}

export interface EgoLiveDeps {
  /** Runs a script with `ego-browser nodejs`, or null when ego lite is not installed. */
  run: ((script: string, timeoutMs: number) => Promise<EgoRun>) | null;
  stateDir: string;
  now?: () => number;
  readShot?: (path: string) => Promise<Buffer>;
  pollMs?: number;
}

export class EgoLive {
  readonly #deps: EgoLiveDeps;
  readonly #viewers = new Map<string, Viewer>();
  readonly #watches = new Map<string, Watch>();

  constructor(deps: EgoLiveDeps) {
    this.#deps = deps;
  }

  get available(): boolean {
    return this.#deps.run !== null;
  }

  #now(): number {
    return this.#deps.now?.() ?? Date.now();
  }

  #send(viewer: Viewer, type: string, data: Json): void {
    try { viewer.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { this.#close(viewer); }
  }

  open({ botId, owner, res }: { botId: string; owner: string; res: ServerResponse }): void {
    if (!this.#deps.run) throw new EgoLiveError("Install ego lite on this computer to watch the bot's browser.", 503);
    const mine = [...this.#viewers.values()].filter((viewer) => viewer.owner === owner && viewer.botId === botId);
    if (this.#viewers.size >= VIEWERS_TOTAL || mine.length >= VIEWERS_PER_PERSON) {
      throw new EgoLiveError("Too many browser views are open. Close one and try again.", 429);
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    const viewer: Viewer = {
      id: randomUUID(), botId, owner, res, seq: 0, sent: null, frame: "", url: "", tabs: "", status: "", control: "",
      heartbeat: setInterval(() => this.#send(viewer, "heartbeat", {}), HEARTBEAT_MS),
    };
    this.#viewers.set(viewer.id, viewer);
    res.on("close", () => this.#close(viewer));
    this.#send(viewer, "ready", { viewerId: viewer.id });
    this.#sendControl(viewer);
    this.#schedule(botId, 0);
  }

  #close(viewer: Viewer): void {
    if (!this.#viewers.delete(viewer.id)) return;
    clearInterval(viewer.heartbeat);
    try { viewer.res.end(); } catch { /* already closed */ }
    const stillWatching = [...this.#viewers.values()].some((other) => other.botId === viewer.botId && other.owner === viewer.owner);
    if (!stillWatching && egoHold(this.#deps.stateDir, viewer.botId, this.#now())?.by === viewer.owner) {
      setEgoHold(this.#deps.stateDir, viewer.botId, null);
      this.#controlAll(viewer.botId);
    }
    if (![...this.#viewers.values()].some((other) => other.botId === viewer.botId)) {
      const watch = this.#watches.get(viewer.botId);
      if (watch?.timer) clearTimeout(watch.timer);
      this.#watches.delete(viewer.botId);
    }
  }

  closeAll(): void {
    for (const viewer of this.#viewers.values()) this.#close(viewer);
  }

  #watch(botId: string): Watch {
    let watch = this.#watches.get(botId);
    if (!watch) this.#watches.set(botId, watch = { timer: null, running: false, tabIds: new Map(), nextTab: 1 });
    return watch;
  }

  #schedule(botId: string, delay: number): void {
    const watch = this.#watch(botId);
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = setTimeout(() => { watch.timer = null; void this.#poll(botId); }, delay);
  }

  #tabId(watch: Watch, targetId: string): string {
    let id = watch.tabIds.get(targetId);
    if (!id) watch.tabIds.set(targetId, id = `t${watch.nextTab++}`);
    return id;
  }

  async #poll(botId: string): Promise<void> {
    const watch = this.#watches.get(botId);
    const viewers = () => [...this.#viewers.values()].filter((viewer) => viewer.botId === botId);
    if (!watch || watch.running || !viewers().length || !this.#deps.run) return;
    watch.running = true;
    let next = this.#deps.pollMs ?? POLL_MS;
    try {
      const ids = botSpaces(this.#deps.stateDir, botId);
      const run = ids.length ? await this.#deps.run(pollScript(ids), RUN_MS) : null;
      const polled = run && run.code === 0 ? marked(run.output) as Polled | null : null;
      if (!polled || polled.space === null) {
        next = IDLE_POLL_MS;
        for (const viewer of viewers()) this.#sendStatus(viewer, false, 1280, 720);
        return;
      }
      await this.#deliver(botId, watch, polled);
    } finally {
      watch.running = false;
      if (viewers().length) this.#schedule(botId, next);
    }
  }

  async #deliver(botId: string, watch: Watch, polled: Polled): Promise<void> {
    const info = polled.info ?? {};
    const width = integer(info.w, 1, 8192) ? info.w : 1280;
    const height = integer(info.h, 1, 8192) ? info.h : 720;
    const tabs = (Array.isArray(polled.tabs) ? polled.tabs : []).slice(0, 100).flatMap((tab) => typeof tab.targetId === "string"
      ? [{ tabId: this.#tabId(watch, tab.targetId), title: text(tab.title, 512) ? tab.title : "", url: displayUrl(tab.url), active: tab.active === true }] : []);
    const shot = typeof polled.shot === "string" && isAbsolute(polled.shot) && SHOT_FILE.test(basename(polled.shot)) ? polled.shot : null;
    const data = shot ? await (this.#deps.readShot ?? readFile)(shot).then((bytes) => bytes.toString("base64"), () => null) : null;
    if (shot && !this.#deps.readShot) void unlink(shot).catch(() => undefined);
    const now = this.#now();
    for (const viewer of [...this.#viewers.values()].filter((each) => each.botId === botId)) {
      this.#sendStatus(viewer, true, width, height);
      const url = displayUrl(info.url);
      if (url !== viewer.url) { viewer.url = url; this.#send(viewer, "url", { url }); }
      const listed = JSON.stringify(tabs);
      if (listed !== viewer.tabs) { viewer.tabs = listed; this.#send(viewer, "tabs", { tabs }); }
      if (!data || data.length > MAX_FRAME || data === viewer.frame) continue;
      if (viewer.sent && now - viewer.sent.at < UNACKED_MS) continue;
      viewer.frame = data;
      viewer.sent = { seq: ++viewer.seq, at: now };
      this.#send(viewer, "frame", { seq: viewer.seq, data, format: "png", metadata: {
        deviceWidth: width, deviceHeight: height, offsetTop: 0, pageScaleFactor: 1,
        scrollOffsetX: number(info.sx, -1e8, 1e8) ? info.sx : 0, scrollOffsetY: number(info.sy, -1e8, 1e8) ? info.sy : 0, timestamp: now,
      } });
    }
  }

  #sendStatus(viewer: Viewer, connected: boolean, viewportWidth: number, viewportHeight: number): void {
    const status = { connected, screencasting: connected, viewportWidth, viewportHeight };
    const key = JSON.stringify(status);
    if (key !== viewer.status) { viewer.status = key; this.#send(viewer, "status", status); }
  }

  #sendControl(viewer: Viewer): void {
    const hold = egoHold(this.#deps.stateDir, viewer.botId, this.#now());
    const mine = hold?.by === viewer.owner;
    const control = { held: hold !== null, owned: mine, controlling: mine };
    const key = JSON.stringify(control);
    if (key !== viewer.control) { viewer.control = key; this.#send(viewer, "control", control); }
  }

  #controlAll(botId: string): void {
    for (const viewer of this.#viewers.values()) if (viewer.botId === botId) this.#sendControl(viewer);
  }

  async action({ viewerId, botId, owner, body }: { viewerId: unknown; botId: string; owner: string; body: unknown }): Promise<Json> {
    const viewer = typeof viewerId === "string" ? this.#viewers.get(viewerId) : undefined;
    if (!viewer || viewer.botId !== botId || viewer.owner !== owner) {
      throw new EgoLiveError("This browser view is no longer available. Reopen the browser panel.", 404);
    }
    const action = parseLiveAction(body);
    const dir = this.#deps.stateDir;
    const now = this.#now();
    if (action.type === "ack") {
      if (viewer.sent?.seq === action.seq) viewer.sent = null;
      return { ok: true };
    }
    if (action.type === "resize") return { ok: true };
    if (action.type === "restart") throw new EgoLiveError("Restart ego lite on the computer itself.");
    const hold = egoHold(dir, botId, now);
    if (action.type === "take") {
      if (hold && hold.by !== owner) throw new EgoLiveError("Someone else is controlling this browser. Try again shortly.");
      setEgoHold(dir, botId, { by: owner, until: now + HOLD_MS });
      this.#controlAll(botId);
      return { ok: true, waited: false };
    }
    if (action.type === "release") {
      if (hold?.by === owner) setEgoHold(dir, botId, null);
      this.#controlAll(botId);
      return { ok: true };
    }
    if (hold?.by !== owner) throw new EgoLiveError("Take control of the browser first.");
    setEgoHold(dir, botId, { by: owner, until: now + HOLD_MS });
    if (action.type === "inputs" && !action.inputs.length) return { ok: true };
    const watch = this.#watch(botId);
    const step: Json = action.type === "tabSelect" || action.type === "tabClose"
      ? { type: action.type, targetId: [...watch.tabIds].find(([, id]) => id === action.tabId)?.[0] ?? "" }
      : { ...action };
    if ("targetId" in step && !step.targetId) throw new EgoLiveError("That tab is closed.");
    const run = this.#deps.run;
    if (!run) throw new EgoLiveError("Install ego lite on this computer to control the bot's browser.", 503);
    const result = await run(actionScript(botSpaces(dir, botId), step), RUN_MS);
    if (result.code !== 0 || !marked(result.output)) {
      const said = result.output.split("\n").map((line) => line.trim()).find((line) => /^(?:Error|EGO_)/u.test(line));
      throw new EgoLiveError(said ? said.replace(/^Error:\s*/u, "").slice(0, 300) : "ego lite did not finish that action. Try again.");
    }
    this.#schedule(botId, 0);
    return { ok: true };
  }
}
