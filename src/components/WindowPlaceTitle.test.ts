// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { windowPlaceName } from "./WindowPlaceTitle";

beforeEach(() => setLocale("en"));
afterEach(() => { delete window.abot; });

it("the top bar names the place as the rail does: This computer, This Mac (or This PC) in a profile, My Cloud while it is home", () => {
  expect(windowPlaceName({ local: true, name: "This computer" }, undefined)).toBe("This computer");
  window.abot = { platform: "darwin" } as unknown as typeof window.abot;
  expect(windowPlaceName({ local: true, name: "This computer", profile: "default" }, undefined)).toBe("This Mac");
  window.abot = { platform: "win32" } as unknown as typeof window.abot;
  expect(windowPlaceName({ local: true, name: "This computer", profile: "default" }, undefined)).toBe("This PC");
  expect(windowPlaceName({ local: false, name: "Studio", home: true }, undefined)).toBe("My Cloud");
});

it("a workspace added from ＋ is called by its own name in the top bar", () => {
  window.abot = { platform: "darwin" } as unknown as typeof window.abot;
  expect(windowPlaceName({ local: true, name: "This computer", profile: "work", profileName: "Work" }, undefined)).toBe("Work");
});
