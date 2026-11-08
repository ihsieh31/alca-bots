import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EgoLive, parseLiveAction } from "./ego-live.ts";
import { egoHold, printedSpaceIds, recordBotSpaces, botSpaces } from "./ego-state.ts";

const dirs: string[] = [];
const lives: EgoLive[] = [];
afterEach(() => {
  for (const live of lives.splice(0)) live.closeAll();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ego-live-"));
  dirs.push(dir);
  return dir;
}

class FakeResponse extends EventEmitter {
  status = 0;
  chunks: string[] = [];
  writeHead(status: number) { this.status = status; return this; }
  write(chunk: string) { this.chunks.push(chunk); return true; }
  end() { return this; }
  events(): Array<{ type: string; data: Record<string, unknown> }> {
    return this.chunks.map((chunk) => {
      const [, type, data] = /^event: (\S+)\ndata: (.*)\n\n$/su.exec(chunk)!;
      return { type: type!, data: JSON.parse(data!) as Record<string, unknown> };
    });
  }
}

const POLLED = { space: 7, info: { url: "https://user:pw@example.com/a", w: 800, h: 600, sx: 0, sy: 40 },
  shot: "/tmp/ego-browser-shot-abc.png", tabs: [{ targetId: "T-A", title: "A", url: "https://example.com/a", active: true }] };

function setup(polled: unknown = POLLED) {
  const dir = stateDir();
  recordBotSpaces(dir, "bot", [7]);
  const scripts: string[] = [];
  const run = vi.fn(async (script: string) => {
    scripts.push(script);
    const out = script.includes("const action =") ? {} : polled;
    return { code: 0, output: `noise\n@@EGO_LIVE@@${JSON.stringify(out)}\n`, timedOut: false };
  });
  const live = new EgoLive({ run, stateDir: dir, pollMs: 60_000, readShot: async () => Buffer.from("png-bytes") });
  lives.push(live);
  const res = new FakeResponse();
  live.open({ botId: "bot", owner: "me", res: res as unknown as ServerResponse });
  const viewerId = res.events()[0]!.data.viewerId as string;
  return { dir, live, res, run, scripts, viewerId };
}

describe("ego live view", () => {
  it("streams the bot's ego lite tab as v1 events, without credentials in the address", async () => {
    const { res, scripts } = setup();
    await vi.waitFor(() => expect(res.events().some((event) => event.type === "frame")).toBe(true));
    const events = res.events();
    expect(events.map((event) => event.type)).toEqual(["ready", "control", "status", "url", "tabs", "frame"]);
    expect(events[1]!.data).toEqual({ held: false, owned: false, controlling: false });
    expect(events[2]!.data).toEqual({ connected: true, screencasting: true, viewportWidth: 800, viewportHeight: 600 });
    expect(events[3]!.data).toEqual({ url: "https://example.com/a" });
    expect(events[4]!.data).toEqual({ tabs: [{ tabId: "t1", title: "A", url: "https://example.com/a", active: true }] });
    expect(events[5]!.data).toMatchObject({ seq: 1, format: "png", data: Buffer.from("png-bytes").toString("base64"),
      metadata: { deviceWidth: 800, deviceHeight: 600, scrollOffsetY: 40 } });
    expect(scripts[0]).toContain("const ids = [7]");
  });

  it("says the browser is not connected when the bot has no space", async () => {
    const { res } = setup({ space: null });
    await vi.waitFor(() => expect(res.events().some((event) => event.type === "status")).toBe(true));
    expect(res.events().find((event) => event.type === "status")!.data).toMatchObject({ connected: false });
  });

  it("takes control as a hold the bot's scripts see, and drives the page only while held", async () => {
    const { dir, live, res, run, scripts, viewerId } = setup();
    const click = { viewerId, type: "input_mouse", eventType: "mousePressed", x: 10, y: 20, button: "left", clickCount: 1 };
    await expect(live.action({ viewerId, botId: "bot", owner: "me", body: click })).rejects.toThrow(/Take control/);
    await expect(live.action({ viewerId, botId: "bot", owner: "me", body: { viewerId, type: "take" } })).resolves.toEqual({ ok: true, waited: false });
    expect(egoHold(dir, "bot")?.by).toBe("me");
    expect(res.events().at(-1)).toEqual({ type: "control", data: { held: true, owned: true, controlling: true } });
    await live.action({ viewerId, botId: "bot", owner: "me", body: click });
    expect(scripts.at(-1)).toContain('"kind":"click","x":10,"y":20,"count":1');
    await live.action({ viewerId, botId: "bot", owner: "me", body: { viewerId, type: "release" } });
    expect(egoHold(dir, "bot")).toBeNull();
    expect(run).toHaveBeenCalled();
  });

  it("releases the hold when the person's last view closes", async () => {
    const { dir, live, res, viewerId } = setup();
    await live.action({ viewerId, botId: "bot", owner: "me", body: { viewerId, type: "take" } });
    res.emit("close");
    expect(egoHold(dir, "bot")).toBeNull();
  });

  it("refuses another person's view of the same viewer id", async () => {
    const { live, viewerId } = setup();
    await expect(live.action({ viewerId, botId: "bot", owner: "someone", body: { viewerId, type: "take" } })).rejects.toThrow(/no longer available/);
  });
});

describe("live actions", () => {
  it("parses v1 actions into fixed steps", () => {
    expect(parseLiveAction({ type: "navigate", url: "https://example.com" })).toEqual({ type: "goto", url: "https://example.com/" });
    expect(() => parseLiveAction({ type: "navigate", url: "javascript:alert(1)" })).toThrow();
    expect(() => parseLiveAction({ type: "navigate", url: "https://a:b@example.com" })).toThrow();
    expect(parseLiveAction({ type: "back" })).toEqual({ type: "history", delta: -1 });
    expect(parseLiveAction({ type: "tab-select", tabId: "t3" })).toEqual({ type: "tabSelect", tabId: "t3" });
    expect(() => parseLiveAction({ type: "tab-select", tabId: "x" })).toThrow();
    expect(parseLiveAction({ type: "input_keyboard", eventType: "keyDown", key: "a", modifiers: 4 })).toEqual({ type: "inputs", inputs: [{ kind: "key", chord: "Meta+a" }] });
    expect(parseLiveAction({ type: "input_keyboard", eventType: "keyDown", key: "a", modifiers: 8 })).toEqual({ type: "inputs", inputs: [] });
    expect(parseLiveAction({ type: "input_keyboard", eventType: "keyDown", key: "Enter" })).toEqual({ type: "inputs", inputs: [{ kind: "key", chord: "Enter" }] });
    expect(parseLiveAction({ type: "input_batch", events: [
      { type: "input_keyboard", eventType: "char", text: "hi" },
      { type: "input_mouse", eventType: "mouseWheel", x: 1, y: 2, deltaY: 100 },
    ] })).toEqual({ type: "inputs", inputs: [{ kind: "text", text: "hi" }, { kind: "wheel", x: 1, y: 2, deltaX: 0, deltaY: 100 }] });
    expect(() => parseLiveAction({ type: "evaluate", script: "x" })).toThrow();
  });
});

describe("ego state", () => {
  it("keeps a bot's spaces newest first and reads printed space ids", () => {
    const dir = stateDir();
    recordBotSpaces(dir, "bot", [1, 2]);
    recordBotSpaces(dir, "bot", [1]);
    expect(botSpaces(dir, "bot")).toEqual([1, 2]);
    recordBotSpaces(dir, "../x", [3]);
    expect(botSpaces(dir, "../x")).toEqual([]);
    expect(printedSpaceIds('{"spaceId": 12} spaceId=4 spaceId: 12')).toEqual([12, 4]);
  });
});
