import { describe, expect, it } from "vitest";

import { barDragProgress, clampProgress } from "./tab-pager";

describe("barDragProgress", () => {
  it("moves one page for one tab's width of travel, from wherever the strip was", () => {
    expect(barDragProgress(0, 90, 90, 4)).toBe(1);
    expect(barDragProgress(2, -45, 90, 4)).toBe(1.5);
  });

  it("stops at the first and last page", () => {
    expect(barDragProgress(0, -300, 90, 4)).toBe(0);
    expect(barDragProgress(3, 300, 90, 4)).toBe(3);
  });

  it("survives a bar with no width yet", () => {
    expect(barDragProgress(1, 0, 0, 4)).toBe(1);
  });
});

describe("clampProgress", () => {
  it("ignores the overscroll a swipe past the edge reports", () => {
    expect(clampProgress(-0.2, 4)).toBe(0);
    expect(clampProgress(3.2, 4)).toBe(3);
  });
});
