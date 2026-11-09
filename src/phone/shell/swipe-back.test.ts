import { describe, expect, it } from "vitest";

import { swipeIntent } from "./swipe-back";

describe("swipeIntent", () => {
  it("waits until the finger has really moved", () => {
    expect(swipeIntent(4, 2)).toBe("undecided");
  });

  it("goes back on a drag to the right", () => {
    expect(swipeIntent(14, 3)).toBe("back");
  });

  it("leaves a vertical drag to the scroller", () => {
    expect(swipeIntent(3, 18)).toBe("not-back");
    expect(swipeIntent(14, 16)).toBe("not-back");
  });

  it("ignores a drag to the left", () => {
    expect(swipeIntent(-14, 1)).toBe("not-back");
  });
});
