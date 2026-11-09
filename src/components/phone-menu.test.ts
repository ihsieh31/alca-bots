import { describe, expect, it } from "vitest";

import { phoneMenuItems } from "./phone-menu";

const item = (key: string, extra = {}) => ({ key, label: key, onSelect: () => {}, ...extra });

describe("phoneMenuItems", () => {
  it("keeps only everyday actions, in their order", () => {
    const kept = phoneMenuItems([item("profile"), item("find"), item("model"), item("computer"), item("new-thread"), item("threads"), item("copy"), item("download"), item("usage"), item("activity"), item("inspector"), item("turn-limit")]);
    expect(kept.map(({ key }) => key)).toEqual(["find", "computer", "new-thread", "threads"]);
  });

  it("drops keyboard hints and a separator left at the top", () => {
    const [first] = phoneMenuItems([item("profile"), item("find", { separatorBefore: true, trailing: "⌘F" })]);
    expect(first).toMatchObject({ key: "find", separatorBefore: false, trailing: undefined });
  });
});
