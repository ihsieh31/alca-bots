import { describe, expect, it, vi } from "vitest";

import { clampView, fitScale, homeView, toPage, zoomAt } from "./geometry";
import { createInputQueue, LIVE_START, liveReducer, pageLabel, type LiveInput } from "./live";

const page = { width: 1280, height: 720 };
const stage = { width: 390, height: 640 };

describe("geometry", () => {
  it("fits the page and centers it", () => {
    expect(fitScale(page, stage)).toBeCloseTo(390 / 1280);
    const view = homeView(page, stage);
    expect(view.x).toBe(0);
    expect(view.y).toBeCloseTo((640 - 219.375) / 2);
  });

  it("maps a tap on the stage to the page, at any zoom", () => {
    const view = homeView(page, stage);
    expect(toPage({ x: 195, y: 320 }, view, page, stage)).toEqual({ x: 640, y: 360 });
    const zoomed = zoomAt(view, 2, { x: 195, y: 320 });
    expect(toPage({ x: 195, y: 320 }, zoomed, page, stage)).toEqual({ x: 640, y: 360 });
  });

  it("gives no page point beside the page", () => {
    expect(toPage({ x: 195, y: 5 }, homeView(page, stage), page, stage)).toBeNull();
  });

  it("doesn't let the page leave the stage or zoom past its limits", () => {
    const zoomed = clampView({ scale: 3, x: 500, y: -5000 }, page, stage);
    expect(zoomed.x).toBe(0);
    expect(zoomed.y).toBeCloseTo(640 - 219.375 * 3);
    expect(clampView({ scale: 99, x: 0, y: 0 }, page, stage).scale).toBe(5);
    expect(clampView({ scale: 0.1, x: 0, y: 0 }, page, stage).scale).toBe(1);
  });
});

describe("liveReducer", () => {
  it("follows the view's events", () => {
    let state = liveReducer(LIVE_START, { type: "ready", viewerId: "v" });
    state = liveReducer(state, { type: "status", connected: true, viewportWidth: 800, viewportHeight: 600 });
    state = liveReducer(state, { type: "control", held: true, controlling: false });
    expect(state).toMatchObject({ viewerId: "v", connected: true, width: 800, height: 600, held: true, controlling: false });
  });

  it("names a page by its host", () => {
    expect(pageLabel("https://www.example.com/a?b")).toBe("example.com");
    expect(pageLabel("")).toBe("");
  });
});

describe("createInputQueue", () => {
  const wheel = (deltaY: number): LiveInput => ({ type: "input_mouse", eventType: "mouseWheel", x: 1, y: 1, deltaX: 0, deltaY });
  const text = (value: string): LiveInput => ({ type: "input_keyboard", eventType: "char", text: value });

  function held() {
    const releases: Array<() => void> = [];
    const send = vi.fn((_events: LiveInput[]) => new Promise<void>((resolve) => { releases.push(resolve); }));
    return { send, release: () => releases.shift()?.() };
  }

  it("sends one batch at a time, joining what piled up", async () => {
    const { send, release } = held();
    const queue = createInputQueue(send, () => {});
    queue.push(wheel(10));
    queue.push(wheel(5));
    queue.push(wheel(7));
    queue.push(text("a"));
    queue.push(text("b"));
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![0]).toEqual([wheel(12), text("ab")]);
  });

  it("keeps a click between scrolls in order", async () => {
    const { send, release } = held();
    const queue = createInputQueue(send, () => {});
    const click: LiveInput = { type: "input_mouse", eventType: "mousePressed", x: 1, y: 1, clickCount: 1 };
    queue.push(wheel(1));
    queue.push(wheel(1));
    queue.push(click);
    queue.push(wheel(1));
    release();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![0]).toEqual([wheel(1), click, wheel(1)]);
  });

  it("stays within the limits the computer accepts", async () => {
    const { send, release } = held();
    const queue = createInputQueue(send, () => {});
    queue.push(wheel(1));
    for (let i = 0; i < 4; i++) queue.push(wheel(5000));
    for (let i = 0; i < 70; i++) queue.push({ type: "input_keyboard", eventType: "keyDown", key: "Tab", modifiers: 0 });
    release();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const batch = send.mock.calls[1]![0];
    expect(batch).toHaveLength(64);
    expect(batch[0]).toMatchObject({ deltaY: 10_000 });
  });

  it("drops what's waiting after a refusal, so old taps don't land later", async () => {
    const onError = vi.fn();
    let rejectFirst: (error: Error) => void = () => {};
    const send = vi.fn((_events: LiveInput[]) => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }));
    const queue = createInputQueue(send, onError);
    queue.push(wheel(1));
    queue.push(text("late"));
    rejectFirst(new Error("no"));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledTimes(1);
  });
});
