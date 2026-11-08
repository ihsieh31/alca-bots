import { describe, expect, it } from "vitest";

import type { Bot, Message } from "@/state/store";
import { elapsedLabel, partnerStatus, partnersInOrder, pendingCards, todayView } from "./derive";

const bot = (over: Partial<Bot>): Bot => ({ id: "b", threadId: "t", mainThreadId: "t", name: "Ledger", unread: false, messages: [], ...over }) as Bot;

describe("todayView", () => {
  it("puts a waiting bot under decisions, not also under working or unread", () => {
    const view = todayView({ bots: [bot({ activity: "waiting-on-you", busy: true, unread: true })], groups: [] });
    expect(view.waiting.map((row) => row.botId)).toEqual(["b"]);
    expect(view.working).toEqual([]);
    expect(view.unread).toEqual([]);
  });

  it("lists each busy conversation with its own title, and the main one without", () => {
    const view = todayView({
      bots: [bot({ tasks: [
        { threadId: "t", title: "Main", createdAt: 1, busy: true, turnStartedAt: 5 },
        { threadId: "x", title: "Invoices", createdAt: 2, busy: true, turnStartedAt: 9 },
      ] })],
      groups: [],
    });
    expect(view.working.map((row) => [row.threadId, row.title])).toEqual([["x", "Invoices"], ["t", undefined]]);
  });

  it("skips hidden bots, routine runs and archived conversations", () => {
    const view = todayView({
      bots: [
        bot({ id: "h", hidden: true, busy: true }),
        bot({ tasks: [
          { threadId: "r", title: "Run", createdAt: 1, busy: true, routineRunId: "run" },
          { threadId: "a", title: "Old", createdAt: 2, busy: true, archivedAt: 3 },
        ] }),
      ],
      groups: [],
    });
    expect(view.working).toEqual([]);
  });

  it("shows unread bots and rooms", () => {
    const view = todayView({ bots: [bot({ unread: true })], groups: [{ id: "g", name: "Launch", unread: true }] as never });
    expect(view.unread.map((row) => [row.id, row.kind])).toEqual([["b", "bot"], ["g", "room"]]);
  });
});

describe("partners", () => {
  it("says the most urgent state across a bot and its conversations", () => {
    expect(partnerStatus(bot({}))).toBe("idle");
    expect(partnerStatus(bot({ busy: true }))).toBe("working");
    expect(partnerStatus(bot({ busy: true, tasks: [{ threadId: "x", title: "", createdAt: 1, activity: "waiting-on-you" }] }))).toBe("waiting");
  });

  it("orders by who needs the person, then pinned, and keeps the rest as they were", () => {
    const ordered = partnersInOrder([
      bot({ id: "a" }), bot({ id: "b", pinned: true }), bot({ id: "c", busy: true }), bot({ id: "d", activity: "waiting-on-you" }), bot({ id: "e" }), bot({ id: "f", hidden: true }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["d", "c", "b", "a", "e"]);
  });
});

describe("pendingCards", () => {
  const card = (over: object) => ({ id: "m", role: "bot", kind: "options", at: 1, card: { requestId: "r", title: "", options: [], ...over } }) as unknown as Message;

  it("keeps requests still open", () => {
    expect(pendingCards([card({})])).toHaveLength(1);
    for (const settled of [{ answered: "allow" }, { expired: true }, { autoApplied: true }, { tool: "Bash" }]) expect(pendingCards([card(settled)])).toEqual([]);
    expect(pendingCards([{ id: "o", role: "bot", kind: "options", at: 1, card: { title: "", options: [] } } as unknown as Message])).toEqual([]);
  });

  it("knows when a secret, a sign-in or a connection is settled", () => {
    const secret = (over: object) => ({ id: "s", role: "bot", kind: "secret", at: 1, secret: over }) as unknown as Message;
    expect(pendingCards([secret({})])).toHaveLength(1);
    for (const settled of [{ provided: true }, { dismissed: true }, { superseded: true }, { stopped: true }, { savedAt: 2 }]) expect(pendingCards([secret(settled)])).toEqual([]);
    const signIn = (over: object) => ({ id: "i", role: "bot", kind: "signin", at: 1, signIn: over }) as unknown as Message;
    expect(pendingCards([signIn({})])).toHaveLength(1);
    expect(pendingCards([signIn({ done: true })])).toEqual([]);
    const connector = (status: string) => ({ id: "c", role: "bot", kind: "connector", at: 1, connector: { status } }) as unknown as Message;
    expect(pendingCards([connector("required")])).toHaveLength(1);
    expect(pendingCards([connector("connected")])).toEqual([]);
  });
});

describe("elapsedLabel", () => {
  it("counts up in the largest unit that reads well", () => {
    expect(elapsedLabel(0, 42_000)).toBe("42s");
    expect(elapsedLabel(0, 360_000)).toBe("6m");
    expect(elapsedLabel(0, 4_800_000)).toBe("1h 20m");
    expect(elapsedLabel(0, 3_600_000)).toBe("1h");
    expect(elapsedLabel(5000, 0)).toBe("0s");
  });
});
