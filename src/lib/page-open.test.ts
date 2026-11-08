// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isPublishedPageUrl, withPageOpen } from "./page-open";

const PAGE = "https://abcdefghijklmnopqrstuvwxyz.alcabot.page/";
describe("a published page's link", () => {
  it("is only https://<page id>.alcabot.page, never an app, chat or look-alike link", () => {
    expect(isPublishedPageUrl(PAGE)).toBe(true);
    expect(isPublishedPageUrl(`${PAGE}charts/index.html?region=EU#top`)).toBe(true);
    for (const other of [
      "alcabots://thread/t1?bot=pepper", "alcabots://bot/pepper", "http://abcdefghijklmnopqrstuvwxyz.alcabot.page/",
      "https://alcabot.page/", "https://www.alcabot.page/", "https://upload.alcabot.page/", "https://a.b.abcdefghijklmnopqrstuvwxyz.alcabot.page/",
      "https://abcdefghijklmnopqrstuvwxyz.alcabot.page.evil.test/", "https://abcdefghijklmnopqrstuvwxyz.alcabot.pages/",
      "https://user:pw@abcdefghijklmnopqrstuvwxyz.alcabot.page/", "https://abcdefghijklmnopqrstuvwxyz.alcabot.page:8443/",
      "javascript:alert(1)", "not a url", "", undefined, null,
    ]) expect(isPublishedPageUrl(other), String(other)).toBe(false);
  });
});

describe("a page link's click", () => {
  const click = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

  it("opens the page like its card's Open, after the link's own handler", () => {
    const open = vi.fn(), own = vi.fn();
    const event = click();
    withPageOpen(PAGE, open, { onClick: own }).onClick!(event as never);
    expect(own).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(PAGE);
  });

  it("stays taken when the link's own handler took it (a long press), and leaves other links alone", () => {
    const open = vi.fn();
    withPageOpen(PAGE, open, { onClick: (event) => event.preventDefault() }).onClick!(click() as never);
    expect(open).not.toHaveBeenCalled();
    const anchor = { onClick: vi.fn() };
    expect(withPageOpen("https://example.com/", open, anchor)).toBe(anchor);
  });
});
