import { canManage, canReach } from "./peer-roster.ts";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MOVE_BOT_FIELDS, moveKindsRoute, type MoveKindsDeps } from "./cloud-send-kinds.ts";
import { chiefLevel, readTeamRolesWith } from "./chief-level.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { defaultBotPatchRefusal, ensureDefaultBot } from "./default-bot.ts";
import * as mdb from "./message-db.ts";
import { Store, type BotRecord } from "./store.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { createBrief } from "./host/brief.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const placeAlcaBots = (store: Store) => store.bots.filter((bot) => bot.defaultBot && !bot.defaultBot.person);
const intros = (store: Store, bot: BotRecord) => (bot.tasks ?? []).flatMap((task) => store.messagesFor(task.threadId)).filter((message) => message.helperIntro);
const boot = (store: Store) => ensureDefaultBot(store, { dataDir: DATA_DIR });
/** Who the daily brief comes from, as the server picks it. */
const briefChief = (store: Store) => createBrief({ store, dataDir: DATA_DIR, hosted: false, watching: () => true, mainThread: (id) => store.bot(id)?.threadId,
  threadBusy: () => false, notify: () => {}, runs: () => [], needsYou: () => [], engineName: () => "Claude", hostTimeZone: () => "UTC", language: () => undefined, session: () => null,
  address: () => undefined, failRun: () => {}, keep: () => {}, items: () => null }).chief();
/** A new install from before AlcaBot was marked: its first bot was AlcaBot in silver, made its Chief. */
function seededBefore(store: Store): BotRecord {
  const seeded = store.createBot({ name: "AlcaBot", color: "silver" });
  store.setChiefOfStaff(seeded.id);
  return seeded;
}

describe("AlcaBot, every person's helper", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
  afterEach(() => readTeamRolesWith(() => null));

  it("gives a fresh install one AlcaBot, its Chief, in chrome, introduced once", () => {
    const store = new Store(selection);
    store.seedIfEmpty();
    boot(store);
    boot(store);
    const again = new Store(selection);
    again.seedIfEmpty();
    boot(again);
    expect(again.bots).toHaveLength(1);
    const alca = placeAlcaBots(again)[0]!;
    expect(alca).toMatchObject({ name: "AlcaBot", color: "chrome", chiefOfStaff: true, defaultBot: {} });
    expect(intros(again, alca)).toHaveLength(1);
  });

  it("leaves a Team Cloud member's AlcaBot uncrowned: it reaches no bot everyone sees, so a crown would promise work it can't hand on", () => {
    const store = new Store(selection);
    store.seedIfEmpty({ defaultBot: false });
    const own = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "ada@acme.test", team: "Acme" })!;
    expect(own.chiefOfStaff).toBeFalsy();
    const fox = store.createBot({ name: "Fox", reportsTo: "ada@acme.test" } as never);
    expect(canReach(own, fox)).toBe(false);
    expect(canManage(own, fox)).toBe(false);
  });

  it("gives an existing install without one a AlcaBot once on update, beside its Chief, which stays exactly as it was", () => {
    const store = new Store(selection);
    const chief = store.createBot({ name: "Pixel" });
    store.setChiefOfStaff(chief.id);
    store.createBot({ name: "Writer", title: "Writer", soul: "Write." });
    const before = structuredClone(store.bot(chief.id));
    const alca = boot(store)!;
    expect(alca).toMatchObject({ name: "AlcaBot", color: "chrome", defaultBot: {} });
    expect(alca.chiefOfStaff).toBeFalsy();
    expect(chiefLevel(alca)).toBe(true);
    expect(store.bot(chief.id)).toEqual(before);
    expect(intros(store, alca)).toHaveLength(1);
    const restarted = new Store(selection);
    boot(restarted);
    expect(placeAlcaBots(restarted).map((bot) => bot.id)).toEqual([alca.id]);
    expect(restarted.bots).toHaveLength(3);
    expect(restarted.bots.filter((bot) => bot.chiefOfStaff).map((bot) => bot.id)).toEqual([chief.id]);
  });

  it("adopts a new install's renamed AlcaBot with its history instead of making another, and puts the intro on top of a new conversation", () => {
    const store = new Store(selection);
    const seeded = seededBefore(store);
    const first = seeded.threadId;
    store.appendMessage(first, { role: "user", kind: "text", text: "Book my flights." });
    store.patchBot(seeded.id, { name: "Jarvis" });
    const history = store.messagesFor(first).map((message) => message.id);
    store.createBot({ name: "Writer" });
    const adopted = boot(store)!;
    expect(adopted.id).toBe(seeded.id);
    expect(adopted).toMatchObject({ name: "Jarvis", color: "chrome", chiefOfStaff: true, defaultBot: {} });
    expect(store.bots).toHaveLength(2);
    expect(history).toHaveLength(2);
    expect(store.messagesFor(first).map((message) => message.id)).toEqual(history);
    expect(adopted.threadId).not.toBe(first);
    expect(store.messagesFor(adopted.threadId).map((message) => message.helperIntro)).toEqual([true]);
    boot(new Store(selection));
    expect(intros(new Store(selection), new Store(selection).bot(seeded.id)!)).toHaveLength(1);
  });

  it("keeps the colour the person gave an adopted AlcaBot", () => {
    const store = new Store(selection);
    const seeded = seededBefore(store);
    store.patchBot(seeded.id, { color: "blue" });
    expect(boot(store)).toMatchObject({ id: seeded.id, color: "blue" });
  });

  it("makes AlcaBot the Chief of a place that has none, so the brief has someone to come from", () => {
    const store = new Store(selection);
    store.createBot({ name: "Pixel" });
    const alca = boot(store)!;
    expect(store.bot(alca.id)?.chiefOfStaff).toBe(true);
    expect(briefChief(store)?.id).toBe(alca.id);
    expect(intros(store, alca)[0]?.text).toContain("Hey! I'm AlcaBot. I'm new here. I'm here to be your Chief of Staff. I can manage your other bots.");
  });

  it("makes an adopted AlcaBot the Chief when its place has none left", () => {
    const store = new Store(selection);
    const seeded = seededBefore(store);
    store.setChiefOfStaff(null);
    expect(store.bot(seeded.id)?.chiefOfStaff).toBeFalsy();
    expect(boot(store)?.id).toBe(seeded.id);
    expect(store.bot(seeded.id)?.chiefOfStaff).toBe(true);
    expect(briefChief(store)?.id).toBe(seeded.id);
  });

  it("leaves a place's own Chief as the Chief, and the brief comes from AlcaBot, which says so", () => {
    const store = new Store(selection);
    const chief = store.createBot({ name: "Clive" });
    store.setChiefOfStaff(chief.id);
    const alca = boot(store)!;
    expect(store.bot(alca.id)?.chiefOfStaff).toBeFalsy();
    expect(briefChief(store)?.id).toBe(alca.id);
    expect(intros(store, alca)[0]?.text).toContain("your helper for everything here");
    expect(intros(store, alca)[0]?.text).toContain("keep an eye on your day");
    expect(intros(store, alca)[0]?.text).not.toContain("Chief of Staff");
  });

  it("keeps a AlcaBot Chief hidden from the sidebar working as the Chief", () => {
    const store = new Store(selection);
    const alca = boot(store)!;
    store.patchBot(alca.id, { sidebarHidden: true });
    const restarted = new Store(selection);
    boot(restarted);
    expect(restarted.bot(alca.id)).toMatchObject({ chiefOfStaff: true, sidebarHidden: true });
    expect(briefChief(restarted)?.id).toBe(alca.id);
  });

  it("knows a renamed AlcaBot by its mark: no second one on update, Chief tools kept", () => {
    const store = new Store(selection);
    store.createBot({ name: "Writer" });
    const chief = store.createBot({ name: "Clive" });
    store.setChiefOfStaff(chief.id);
    const alca = boot(store)!;
    store.patchBot(alca.id, { name: "Jarvis", color: "blue" });
    const restarted = new Store(selection);
    boot(restarted);
    expect(placeAlcaBots(restarted).map((bot) => [bot.id, bot.name])).toEqual([[alca.id, "Jarvis"]]);
    expect(chiefLevel(restarted.bot(alca.id))).toBe(true);
    expect(restarted.bots).toHaveLength(3);
  });

  it("never takes a first bot that is not a new install's AlcaBot: it gets a AlcaBot beside it", () => {
    const store = new Store(selection);
    const pixel = store.createBot({ name: "Pixel" });
    const alca = boot(store)!;
    expect(alca.id).not.toBe(pixel.id);
    expect(store.bot(pixel.id)?.defaultBot).toBeUndefined();
  });

  it("introduces itself once: not again after the asks were answered or dismissed, nor after a restart", () => {
    const store = new Store(selection);
    const alca = boot(store)!;
    const [intro] = intros(store, alca);
    expect(intro?.card?.options).toHaveLength(4);
    store.appendMessage(alca.threadId, { role: "user", kind: "text", text: "What can you do?" });
    expect(store.messagesFor(alca.threadId).find((message) => message.id === intro!.id)?.card?.dismissed).toBe(true);
    for (let restart = 0; restart < 2; restart++) boot(new Store(selection));
    const after = new Store(selection);
    expect(intros(after, after.bot(alca.id)!)).toHaveLength(1);
  });

  it("never counts its intro as something that needs the person", () => {
    const store = new Store(selection);
    const alca = boot(store)!;
    expect(intros(store, alca)).toHaveLength(1);
    expect(mdb.attentionRows(0).filter((row) => row.kind === "options")).toEqual([]);
  });

  it("is hidden, never deleted or archived, and a hidden AlcaBot is never made again", () => {
    const store = new Store(selection);
    const alca = boot(store)!;
    const other = store.createBot({ name: "Writer" });
    expect(() => store.deleteBot(alca.id)).toThrow(/AlcaBot can't be deleted or archived/);
    expect(store.bot(alca.id)).toBeTruthy();
    expect(defaultBotPatchRefusal(alca, { hidden: true })).toMatch(/Show AlcaBot in the sidebar/);
    expect(defaultBotPatchRefusal(other, { sidebarHidden: true })).toMatch(/Only AlcaBot/);
    expect(defaultBotPatchRefusal(alca, { sidebarHidden: "yes" })).toBe("sidebarHidden must be true or false");
    expect(defaultBotPatchRefusal(alca, { sidebarHidden: true })).toBeNull();
    store.patchBot(alca.id, { sidebarHidden: true });
    const restarted = new Store(selection);
    boot(restarted);
    expect(placeAlcaBots(restarted).map((bot) => [bot.id, bot.sidebarHidden])).toEqual([[alca.id, true]]);
    restarted.patchBot(alca.id, { sidebarHidden: false });
    expect(new Store(selection).bot(alca.id)?.sidebarHidden).toBe(false);
  });

  it("is never made twice for one place, even once its mark is gone", () => {
    const store = new Store(selection);
    const alca = boot(store)!;
    store.patchBot(alca.id, { defaultBot: undefined });
    expect(boot(store)).toBeNull();
    expect(store.bots).toHaveLength(1);
  });

  it("keeps the oldest when two are marked", () => {
    const store = new Store(selection);
    const first = boot(store)!;
    const second = store.createBot({ name: "AlcaBot 2" });
    store.patchBot(second.id, { defaultBot: {} });
    expect(boot(store)?.id).toBe(first.id);
    expect(placeAlcaBots(store).map((bot) => bot.id)).toEqual([first.id]);
  });

  it("gives each Team Cloud member their own private AlcaBot, and the team no AlcaBot of its own", () => {
    const store = new Store(selection);
    store.seedIfEmpty({ defaultBot: false });
    expect(store.bots).toHaveLength(1);
    expect(store.bots[0]).toMatchObject({ chiefOfStaff: true });
    expect(store.bots[0]?.defaultBot).toBeUndefined();
    const ada = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "Ada@Example.com", team: "Acme" })!;
    const bea = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "bea@example.com", team: "Acme" })!;
    expect(ensureDefaultBot(store, { dataDir: DATA_DIR, person: "ada@example.com", team: "Acme" })?.id).toBe(ada.id);
    expect(ada).toMatchObject({ name: "AlcaBot", defaultBot: { person: "ada@example.com" }, visibility: { people: ["ada@example.com"] } });
    expect(bea).toMatchObject({ defaultBot: { person: "bea@example.com" }, visibility: { people: ["bea@example.com"] } });
    expect(ada.chiefOfStaff).toBeFalsy();
    expect(intros(store, ada)[0]?.text).toContain("On Acme, I'm here for you and look after your own bots.");
    expect(intros(store, ada)[0]?.text).not.toContain("keep an eye on your day");
    expect(store.bots).toHaveLength(3);
  });

  it("holds a Chief's tools, never more than its member: a User's AlcaBot holds none", () => {
    const store = new Store(selection);
    const place = boot(store)!;
    const member = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "user@example.com", team: "Acme" })!;
    const admin = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "admin@example.com", team: "Acme" })!;
    const tools = (bot: BotRecord) => availableTools(catalogProfileFromEnv({ ALCA_CHIEF_OF_STAFF: chiefLevel(bot) ? "1" : "0", ALCA_BOT_ID: bot.id })).map((tool) => tool.name);
    expect(tools(place)).toEqual(expect.arrayContaining(["create_bot", "propose_team_setup", "retry_thread", "manage_room"]));
    expect([chiefLevel(member), chiefLevel(admin)]).toEqual([false, false]);
    readTeamRolesWith((email) => email === "admin@example.com" ? "admin" : email === "user@example.com" ? "member" : null);
    expect([chiefLevel(member), chiefLevel(admin)]).toEqual([false, true]);
    expect(tools(member)).not.toContain("create_bot");
    expect(tools(admin)).toContain("create_bot");
  });

  describe("moves", () => {
    const OWNER = { person: "p_owner0000000000000000", name: "Amit" };
    const deps = (store: Store): MoveKindsDeps => ({ dataDir: DATA_DIR, store, routines: () => null, calls: () => null, webhooks: () => null, appEvents: () => null,
      claudeCodeSkills: () => [], instanceExists: () => true, owner: () => OWNER, ownRoutine: () => {} } as unknown as MoveKindsDeps);
    async function arrive(store: Store, id: string, record: Record<string, unknown>) {
      let status = 0;
      await moveKindsRoute(deps(store), { path: "/api/cloud-send/kind", method: "PUT", url: new URL("http://127.0.0.1/api/cloud-send/kind"), auth: {} as never, req: {} as never,
        res: { setHeader() {} } as never, json: ((_res: unknown, code: number) => { status = code; }) as never,
        readBody: (async () => ({ v: 1, key: `bot:${id}`, dataDir: "/Users/amit/.alcabots", record })) as never });
      return status;
    }
    const fields = (bot: Record<string, unknown>) => Object.fromEntries(MOVE_BOT_FIELDS.map((name) => [name, bot[name] ?? null]));

    it("leaves My Cloud exactly one AlcaBot when this computer's arrives: My Cloud's unused one is archived, whatever order the Chief comes in", async () => {
      const cloud = new Store(selection);
      cloud.seedIfEmpty();
      boot(cloud);
      const starter = placeAlcaBots(cloud)[0]!;
      const arrivingMaus = cloud.createBot({ name: "AlcaBot" }, { id: "desk-alca-000001", seedMessages: false });
      expect(await arrive(cloud, arrivingMaus.id, fields({ defaultBot: {}, sidebarHidden: true, welcomed: true }))).toBe(200);
      expect(placeAlcaBots(cloud).map((bot) => bot.id)).toEqual([arrivingMaus.id]);
      expect(cloud.bot(arrivingMaus.id)).toMatchObject({ sidebarHidden: true, welcomed: true });
      expect(cloud.bot(starter.id)).toMatchObject({ chiefOfStaff: true });
      expect(cloud.bot(starter.id)?.hidden).toBeFalsy();
      const pixel = cloud.createBot({ name: "Pixel" }, { id: "desk-chief-00001", seedMessages: false });
      expect(await arrive(cloud, pixel.id, fields({ chiefOfStaff: true }))).toBe(200);
      expect(cloud.bot(starter.id)).toMatchObject({ hidden: true });
      expect(cloud.bot(starter.id)?.defaultBot).toBeUndefined();
      expect(cloud.bots.filter((bot) => bot.chiefOfStaff).map((bot) => bot.id)).toEqual([pixel.id]);
      expect(placeAlcaBots(cloud).map((bot) => bot.id)).toEqual([arrivingMaus.id]);
    });

    it("still makes one AlcaBot on My Cloud when this computer's arrives renamed and with its own picture", async () => {
      const cloud = new Store(selection);
      cloud.seedIfEmpty();
      boot(cloud);
      const starter = placeAlcaBots(cloud)[0]!;
      cloud.patchBot(starter.id, { name: "Starter" });
      const arriving = cloud.createBot({ name: "Jarvis" }, { id: "desk-alca-000003", seedMessages: false });
      cloud.patchBot(arriving.id, { avatarUrl: "/api/attachments/jarvis.png", avatarCrop: "circle" });
      expect(await arrive(cloud, arriving.id, fields({ defaultBot: {}, welcomed: true }))).toBe(200);
      expect(placeAlcaBots(cloud).map((bot) => [bot.id, bot.name, bot.avatarUrl])).toEqual([[arriving.id, "Jarvis", "/api/attachments/jarvis.png"]]);
      expect(cloud.bot(starter.id)?.defaultBot).toBeUndefined();
    });

    it("keeps a My Cloud AlcaBot someone already used as an ordinary bot", async () => {
      const cloud = new Store(selection);
      const theirs = boot(cloud)!;
      cloud.appendMessage(theirs.threadId, { role: "user", kind: "text", text: "Hi" });
      const arriving = cloud.createBot({ name: "AlcaBot" }, { id: "desk-alca-000002", seedMessages: false });
      expect(await arrive(cloud, arriving.id, fields({ defaultBot: {} }))).toBe(200);
      expect(placeAlcaBots(cloud).map((bot) => bot.id)).toEqual([arriving.id]);
      expect(cloud.bot(theirs.id)?.hidden).toBeFalsy();
    });

    it("comes home to exactly the one AlcaBot My Cloud had, and makes none", () => {
      const cloud = new Store(selection);
      cloud.seedIfEmpty();
      const alcaOnCloud = boot(cloud)!;
      cloud.patchBot(alcaOnCloud.id, { name: "Jarvis", sidebarHidden: true });
      const backup = readFileSync(join(DATA_DIR, "bots.json"), "utf8");
      for (const file of ["bots.json", "default-bot.json"]) rmSync(join(DATA_DIR, file), { force: true });
      const desk = new Store(selection);
      desk.seedIfEmpty();
      boot(desk);
      rmSync(join(DATA_DIR, "bots.json"));
      writeFileSync(join(DATA_DIR, "bots.json"), backup);
      const home = new Store(selection);
      home.seedIfEmpty();
      boot(home);
      expect(home.bots.map((bot) => bot.id)).toEqual([alcaOnCloud.id]);
      expect(placeAlcaBots(home)[0]).toMatchObject({ name: "Jarvis", sidebarHidden: true });
    });
  });
});
