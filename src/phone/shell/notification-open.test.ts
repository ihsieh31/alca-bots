import { describe, expect, it } from "vitest";

import { openTargetFrom } from "./notification-open";

describe("openTargetFrom", () => {
  it("reads where a notification points", () => {
    expect(openTargetFrom("?open.botId=b&open.threadId=t")).toEqual({ botId: "b", threadId: "t" });
    expect(openTargetFrom("?open.groupId=g")).toEqual({ groupId: "g" });
  });

  it("ignores everything else", () => {
    expect(openTargetFrom("")).toBeNull();
    expect(openTargetFrom("?other=1&open.nope=2")).toBeNull();
  });
});
