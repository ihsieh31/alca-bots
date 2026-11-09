import { describe, expect, it } from "vitest";

import { NAV_START, navReducer, usesBrowserHistory } from "./nav";

describe("navReducer", () => {
  it("pushes screens and pops back to a history depth", () => {
    const pushed = navReducer(navReducer(NAV_START, { type: "push", route: { kind: "chat" } }), { type: "push", route: { kind: "apps" } });
    expect(pushed.stack.map((route) => route.kind)).toEqual(["chat", "apps"]);
    expect(navReducer(pushed, { type: "depth", depth: 1 }).stack.map((route) => route.kind)).toEqual(["chat"]);
    expect(navReducer(pushed, { type: "depth", depth: 0 }).stack).toEqual([]);
  });

  it("ignores a depth at or beyond what is shown, and keeps the tab under a screen", () => {
    const pushed = navReducer({ ...NAV_START, tab: "work" }, { type: "push", route: { kind: "chat" } });
    expect(navReducer(pushed, { type: "depth", depth: 4 })).toBe(pushed);
    expect(navReducer(pushed, { type: "depth", depth: 0 }).tab).toBe("work");
  });

  it("leaves the state alone when the same tab is chosen", () => {
    expect(navReducer(NAV_START, { type: "tab", tab: "today" })).toBe(NAV_START);
    expect(navReducer(NAV_START, { type: "tab", tab: "more" }).tab).toBe("more");
  });
});

describe("usesBrowserHistory", () => {
  it("leaves history empty only in an iPhone home-screen app", () => {
    expect(usesBrowserHistory(true, true)).toBe(false);
    expect(usesBrowserHistory(true, false)).toBe(true);
    expect(usesBrowserHistory(false, true)).toBe(true);
    expect(usesBrowserHistory(false, false)).toBe(true);
  });
});
