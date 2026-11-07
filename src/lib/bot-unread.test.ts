import { afterEach, describe, expect, it, vi } from "vitest";

import { botUnreadCount, showBrowserUnread, titleWithUnread } from "./bot-unread";

describe("what one bot adds to the unread count", () => {
  it("adds one while it shows unread, and nothing once read, as it always did", () => {
    expect(botUnreadCount({ tasks: [{ unread: true }, { unread: true }] })).toBe(1);
    expect(botUnreadCount({ unread: true })).toBe(1);
    expect(botUnreadCount({ tasks: [{ unread: false }] })).toBe(0);
  });

  it("adds each ask waiting on the person in their inbox, read or not, and drops them as they are settled", () => {
    expect(botUnreadCount({ tasks: [{ unread: true, openAsks: 3 }] })).toBe(3);
    expect(botUnreadCount({ tasks: [{ unread: false, openAsks: 2 }] })).toBe(2);
    expect(botUnreadCount({ tasks: [{ unread: true, openAsks: 1 }] })).toBe(1);
    expect(botUnreadCount({ tasks: [{ unread: false }] }), "all settled").toBe(0);
  });
});

describe("browser unread indicator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefixes the title with the count, replaces an older count, and drops it at zero", () => {
    expect(titleWithUnread("AlcaBots", 3)).toBe("(3) AlcaBots");
    expect(titleWithUnread("(3) AlcaBots", 5)).toBe("(5) AlcaBots");
    expect(titleWithUnread("(5) Acme", 0)).toBe("Acme");
    expect(titleWithUnread("Acme", 0)).toBe("Acme");
  });

  it("sets the title and the app badge, and clears both", () => {
    const doc = { title: "AlcaBots" };
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });

    showBrowserUnread(2);
    expect(doc.title).toBe("(2) AlcaBots");
    expect(setAppBadge).toHaveBeenCalledWith(2);

    showBrowserUnread(0);
    expect(doc.title).toBe("AlcaBots");
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("keeps the page's own title, such as a white-label name or a preview page's", () => {
    const doc = { title: "Isolated Alca Chat" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", {});
    showBrowserUnread(0);
    expect(doc.title).toBe("Isolated Alca Chat");
    showBrowserUnread(1);
    expect(doc.title).toBe("(1) Isolated Alca Chat");
  });

  it("still sets the title where the Badging API is missing or refuses", () => {
    const doc = { title: "AlcaBots" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", {});
    showBrowserUnread(1);
    expect(doc.title).toBe("(1) AlcaBots");

    vi.stubGlobal("navigator", { setAppBadge: () => Promise.reject(new Error("NotAllowedError")) });
    showBrowserUnread(4);
    expect(doc.title).toBe("(4) AlcaBots");
  });
});
