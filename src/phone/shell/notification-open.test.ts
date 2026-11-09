import { describe, expect, it } from "vitest";

import { pendingTarget } from "./notification-open";

const NOW = 1_000_000_000;

describe("pendingTarget", () => {
  it("reads where a fresh notification points", () => {
    expect(pendingTarget({ botId: "b", threadId: "t", at: NOW - 1000 }, NOW)).toEqual({ botId: "b", threadId: "t" });
    expect(pendingTarget({ groupId: "g", at: NOW }, NOW)).toEqual({ groupId: "g" });
  });

  it("drops a tap from long ago", () => {
    expect(pendingTarget({ botId: "b", at: NOW - 6 * 60_000 }, NOW)).toBeNull();
  });

  it("ignores anything that isn't a target", () => {
    expect(pendingTarget(null, NOW)).toBeNull();
    expect(pendingTarget({ at: NOW }, NOW)).toBeNull();
    expect(pendingTarget({ botId: "b" }, NOW)).toBeNull();
    expect(pendingTarget({ botId: 5, at: NOW }, NOW)).toBeNull();
  });
});
