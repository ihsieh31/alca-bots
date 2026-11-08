import { describe, expect, it } from "vitest";

import { transitionComputerControlLease } from "../lib/computer-control";

const snap = (held: boolean) => ({ held, helpReason: null });

describe("computer control transition", () => {
  it("returns the server's snapshot when it matches the action", async () => {
    await expect(transitionComputerControlLease({ action: "take", requestControl: async () => snap(true) })).resolves.toEqual(snap(true));
    await expect(transitionComputerControlLease({ action: "release", requestControl: async () => snap(false) })).resolves.toEqual(snap(false));
  });

  it("fails when the server did not release", async () => {
    await expect(transitionComputerControlLease({ action: "release", requestControl: async () => snap(true) })).rejects.toThrow(/could not release/i);
  });
});
