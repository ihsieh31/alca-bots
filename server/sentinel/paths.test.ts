import { describe, expect, it } from "vitest";

import { defaultSentinelOut, isInside } from "./paths.ts";

describe("sentinel paths", () => {
  it("keeps Sentinel's files in the platform's state folder, outside the data dir", () => {
    expect(defaultSentinelOut("/Users/alca/.alcabots", "darwin", "/Users/alca", {})).toBe("/Users/alca/Library/Application Support/alcabots-sentinel");
    expect(defaultSentinelOut("/home/alca/.alcabots", "linux", "/home/alca", {})).toBe("/home/alca/.local/state/alcabots-sentinel");
    expect(defaultSentinelOut("/home/alca/.alcabots", "linux", "/home/alca", { XDG_STATE_HOME: "/var/state/alca" })).toBe("/var/state/alca/alcabots-sentinel");
    // a relative XDG_STATE_HOME is invalid by the spec and ignored
    expect(defaultSentinelOut("/home/alca/.alcabots", "linux", "/home/alca", { XDG_STATE_HOME: "state" })).toBe("/home/alca/.local/state/alcabots-sentinel");
    expect(defaultSentinelOut("C:\\Users\\alca\\.alcabots", "win32", "C:\\Users\\alca", { LOCALAPPDATA: "D:\\Local" })).toBe("D:\\Local\\alcabots-sentinel");
  });

  it("gives any other data dir its own subfolder, the same one every time", () => {
    const other = defaultSentinelOut("/srv/alca-data", "linux", "/home/alca", {});
    expect(other).toMatch(/^\/home\/alca\/\.local\/state\/alcabots-sentinel\/data-[0-9a-f]{12}$/);
    expect(defaultSentinelOut("/srv/alca-data", "linux", "/home/alca", {})).toBe(other);
    expect(defaultSentinelOut("/srv/alca-data-2", "linux", "/home/alca", {})).not.toBe(other);
  });

  it("knows when a folder is inside another", () => {
    expect(isInside("/d/alca/sentinel", "/d/alca", "linux")).toBe(true);
    expect(isInside("/d/alca", "/d/alca", "linux")).toBe(true);
    expect(isInside("/d/alca-sentinel", "/d/alca", "linux")).toBe(false);
    expect(isInside("/d", "/d/alca", "linux")).toBe(false);
    expect(isInside("C:\\d\\alca\\x", "C:\\d\\alca", "win32")).toBe(true);
  });
});
