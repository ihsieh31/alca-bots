import { describe, expect, it } from "vitest";

import { chiefChoices, chiefFor, chiefStepFits, createChiefPatch, hiddenFromSidebar, INTRO_CHIPS, introChips, myDefaultBot, setupSteps, someoneElsesDefaultBot } from "./default-bot";
import { partitionSidebarBots } from "./sidebar-layout";
import type { DefaultBotFields } from "../../shared/default-bot";

const bot = (id: string, fields: DefaultBotFields = {}): DefaultBotFields & { id: string } => ({ id, ...fields });

describe("AlcaBot in the sidebar", () => {
  it("leaves out a AlcaBot whose Show switch is off, and on a Team Cloud other people's, but keeps the viewer's own", () => {
    const bots = [
      bot("alca", { defaultBot: {} }),
      bot("ada-alca", { defaultBot: { person: "ada@example.com" } }),
      bot("bea-alca", { defaultBot: { person: "bea@example.com" } }),
      bot("writer"),
    ];
    const shown = (viewerEmail: string | null) => partitionSidebarBots(bots, { viewerEmail }).unsectionedBots.map((entry) => entry.id);
    expect(shown("ada@example.com")).toEqual(["alca", "ada-alca", "writer"]);
    expect(shown(null)).toEqual(["alca", "writer"]);
    bots[0] = bot("alca", { defaultBot: {}, sidebarHidden: true });
    expect(shown(null)).toEqual(["writer"]);
    expect(hiddenFromSidebar(bots[0]!, null)).toBe(true);
    expect(someoneElsesDefaultBot(bots[2]!, "ADA@example.com".toLowerCase())).toBe(true);
  });

  it("finds the viewer's own AlcaBot: their own on a team, the place's otherwise, none until the viewer is known", () => {
    const team = [bot("ada-alca", { defaultBot: { person: "ada@example.com" } }), bot("writer")];
    expect(myDefaultBot(team, undefined)).toBeUndefined();
    expect(myDefaultBot(team, "ada@example.com")?.id).toBe("ada-alca");
    expect(myDefaultBot(team, "bea@example.com")).toBeUndefined();
    const place = [bot("writer"), bot("alca", { defaultBot: {} })];
    expect(myDefaultBot(place, null)?.id).toBe("alca");
    expect(myDefaultBot(place, "owner@example.com")?.id).toBe("alca");
  });
});

describe("AlcaBot's identity is its mark, never its name", () => {
  it("keeps finding a renamed AlcaBot for the Settings switch and the sidebar, and keeps it out of the list while its welcome is open", () => {
    const bots = [bot("writer"), { ...bot("alca", { defaultBot: {} }), name: "Jarvis" }];
    expect(myDefaultBot(bots, null)?.id).toBe("alca");
    expect(partitionSidebarBots(bots, { viewerEmail: null }).unsectionedBots.map((entry) => entry.id)).toEqual(["writer", "alca"]);
    expect(partitionSidebarBots(bots, { viewerEmail: null, welcoming: "alca" }).unsectionedBots.map((entry) => entry.id)).toEqual(["writer"]);
  });
});

describe("what AlcaBot offers to set up", () => {
  const fresh = { aiReady: false, ownBots: 0, onCloud: false, team: false, remote: false };

  it("in Advanced mode, as on a new install before: an AI, bots, apps, the phone and the Cloud", () => {
    expect(setupSteps(fresh)).toEqual(["ai", "bots", "apps", "phone", "cloud"]);
    expect(setupSteps({ ...fresh, aiReady: true, onCloud: true })).toEqual(["bots", "apps", "phone"]);
    expect(setupSteps({ ...fresh, ownBots: 3 })).toEqual(["ai"]);
    expect(setupSteps({ ...fresh, team: true })).toEqual([]);
  });

  it("in Simple mode, chips for only what its look around found missing, in order: AI, apps, skills, phone, Cloud", () => {
    expect(introChips(fresh)).toEqual(["ai", "apps", "phone", "cloud"]);
    expect(introChips({ ...fresh, aiReady: true, importFound: true })).toEqual(["apps", "import", "phone", "cloud"]);
    expect(introChips({ ...fresh, aiReady: true, appsConnected: true, phonePaired: true })).toEqual(["cloud"]);
    expect(introChips({ ...fresh, aiReady: true, remote: true })).toEqual(["apps", "phone"]);
    expect(introChips({ ...fresh, aiReady: true, onCloud: true, importFound: false })).toEqual(["apps", "phone"]);
    expect(INTRO_CHIPS).toBe(3);
  });

  it("never offers a bot (the sidebar's + adds one), nor nags a person who is set up or a Team Cloud member", () => {
    expect(introChips(fresh)).not.toContain("bots");
    expect(introChips({ ...fresh, aiReady: true, ownBots: 3, importFound: true })).toEqual([]);
    expect(introChips({ ...fresh, ownBots: 3 })).toEqual(["ai"]);
    expect(introChips({ ...fresh, team: true })).toEqual([]);
  });
});

describe("the first run's Chief step", () => {
  const alca = { id: "alca", defaultBot: {}, chiefOfStaff: true };

  it("shows for a AlcaBot not yet introduced, where it is the Chief or there is none", () => {
    expect(chiefStepFits([alca], alca)).toBe(true);
    expect(chiefStepFits([{ ...alca, chiefOfStaff: false }], { ...alca, chiefOfStaff: false })).toBe(true);
  });

  it("is skipped where another bot is the Chief, once AlcaBot has met the person, and with no AlcaBot", () => {
    const other = { ...alca, chiefOfStaff: false };
    expect(chiefStepFits([other, { id: "research", chiefOfStaff: true }], other)).toBe(false);
    expect(chiefStepFits([{ ...alca, welcomed: true }], { ...alca, welcomed: true })).toBe(false);
    expect(chiefStepFits([{ id: "research" }], undefined)).toBe(false);
  });

  it("keeps a Chief in another department out of it", () => {
    const other = { ...alca, chiefOfStaff: false };
    expect(chiefStepFits([other, { id: "sales", chiefOfStaff: true, section: "Sales" }], other)).toBe(true);
  });
});

describe("who becomes the Chief of Staff on the first run", () => {
  type Candidate = { id: string; defaultBot?: { person?: string }; chiefOfStaff?: boolean; section?: string; hidden?: boolean };
  const alca: Candidate = { id: "alca", defaultBot: {}, chiefOfStaff: true };
  const research: Candidate = { id: "research" };

  it("finds the Chief in AlcaBot's own department, never a department's or a hidden one", () => {
    expect(chiefFor([alca, research], alca)?.id).toBe("alca");
    expect(chiefFor([{ ...alca, chiefOfStaff: false }, { ...research, chiefOfStaff: true }], alca)?.id).toBe("research");
    expect(chiefFor([{ ...alca, chiefOfStaff: false }, { id: "sales", section: "Sales", chiefOfStaff: true }], alca)).toBeUndefined();
    expect(chiefFor([{ ...alca, chiefOfStaff: false }, { id: "old", chiefOfStaff: true, hidden: true }], alca)).toBeUndefined();
  });

  it("offers the person's own bots there to choose from, never AlcaBot, a hidden bot or someone else's", () => {
    const bots: Candidate[] = [alca, research, { id: "sales", section: "Sales" }, { id: "gone", hidden: true }, { id: "ada-alca", defaultBot: { person: "ada@example.com" } }];
    expect(chiefChoices(bots, alca, null).map((bot) => bot.id)).toEqual(["research"]);
    expect(chiefChoices([alca], alca, null)).toEqual([]);
  });

  it("Create makes AlcaBot the Chief only where there is none, and never takes the role from a Chief someone has", () => {
    expect(createChiefPatch({ defaultBot: {} }, undefined)).toEqual({ welcomed: true, chiefOfStaff: true });
    expect(createChiefPatch({ defaultBot: {} }, alca)).toEqual({ welcomed: true });
    expect(createChiefPatch({ defaultBot: {}, sidebarHidden: true }, alca), "back in the sidebar").toEqual({ welcomed: true, sidebarHidden: false });
  });
});
