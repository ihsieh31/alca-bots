import { describe, expect, it } from "vitest";

import { pushStateFrom } from "./push";

const facts = { apple: false, standalone: false, api: true, permission: "default", subscribed: false };

describe("pushStateFrom", () => {
  it("asks an iPhone tab to go to the Home Screen first, whatever else is true", () => {
    expect(pushStateFrom({ ...facts, apple: true, api: false })).toBe("needs-install");
    expect(pushStateFrom({ ...facts, apple: true, standalone: true })).toBe("off");
  });

  it("says when a browser has no push", () => {
    expect(pushStateFrom({ ...facts, api: false })).toBe("unsupported");
  });

  it("treats a refusal in the phone's settings as out of the page's hands", () => {
    expect(pushStateFrom({ ...facts, permission: "denied", subscribed: true })).toBe("denied");
  });

  it("is on only with both the permission and a subscription", () => {
    expect(pushStateFrom({ ...facts, permission: "granted", subscribed: true })).toBe("on");
    expect(pushStateFrom({ ...facts, permission: "granted" })).toBe("off");
    expect(pushStateFrom({ ...facts, subscribed: true })).toBe("off");
  });
});
