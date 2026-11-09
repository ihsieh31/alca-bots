import { describe, expect, it } from "vitest";

import { keyboardCover } from "./use-keyboard-inset";

describe("keyboardCover", () => {
  it("is zero with no keyboard", () => {
    expect(keyboardCover(874, 0, 874)).toBe(0);
  });

  it("measures the keyboard from the shell, whatever window.innerHeight says", () => {
    expect(keyboardCover(874, 0, 488)).toBe(386);
  });

  it("allows for a scrolled visual viewport", () => {
    expect(keyboardCover(874, 40, 488)).toBe(346);
  });

  it("never goes negative", () => {
    expect(keyboardCover(800, 0, 874)).toBe(0);
  });
});
