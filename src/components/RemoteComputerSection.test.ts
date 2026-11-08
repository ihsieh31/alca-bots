import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { isServerPairingLink, RemoteComputerSection } from "./RemoteComputerSection";

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("self-hosted server pairing links", () => {
  it.each([
    "https://bots.example.com/pair#code=ABCD-EFGH-JKLM",
    " https://custom.example.com:8443/pair/#code=ABCD%2DEFGH%2DJKLM ",
    "https://random.trycloudflare.com/pair#code=ABCDEFGHJKLM",
  ])("accepts a complete custom HTTPS link: %s", (link) => {
    expect(isServerPairingLink(link)).toBe(true);
  });

  it.each([
    "",
    "ABCD-EFGH-JKLM",
    "http://bots.example.com/pair#code=ABCD-EFGH-JKLM",
    "https:example.com/pair#code=ABCD-EFGH-JKLM",
    "https://user:secret@bots.example.com/pair#code=ABCD-EFGH-JKLM",
    "https://bots.example.com",
    "https://bots.example.com/pair",
    "https://bots.example.com/pair#code=",
    "https://bots.example.com/pair#code=%20",
    "https://bots.example.com/pair#code=%",
    "https://bots.example.com/other#code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair?code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair?code=secret#code=ABCD-EFGH-JKLM",
    "https://bots.example.com/pair#code=ABCD EFGH JKLM",
    "https://bots.example.com\\@other.example/pair#code=ABCD-EFGH-JKLM",
    "alcabots://pair?code=123456",
  ])("rejects an incomplete, malformed, or insecure link: %s", (link) => {
    expect(isServerPairingLink(link)).toBe(false);
  });
});

describe("remote connection Settings", () => {
  const render = (abot?: unknown) => {
    vi.stubGlobal("window", { abot });
    setLocale("en");
    return renderToStaticMarkup(createElement(RemoteComputerSection));
  };
  const environments = { addFromLink: vi.fn() };

  it("defaults to server pairing and explains how to obtain a fresh full link", () => {
    const html = render({ environments });
    expect(html).toContain("Server pairing link");
    // Full access first: only it can make a server you own your bots' home; chat-only says what it can't do.
    expect(html.indexOf('data-pair-access="full"')).toBeLessThan(html.indexOf('data-pair-access="client"'));
    expect(html).toMatch(/data-pair-access="full"[\s\S]*?Your own server: full access[\s\S]*?>npx alcabots pair<\/code>/);
    expect(html).toMatch(/data-pair-access="client"[\s\S]*?chat and approvals only[\s\S]*?>npx alcabots pair --client<\/code>[\s\S]*?make the server your bots[\s\S]{1,8}home/);
    expect(html).toContain("12-character code");
    expect(html).toContain("custom domains and Cloudflare Tunnel");
    expect(html).toContain("Connect to server");
    expect(html).toContain("Server menu");
    expect(html).not.toContain('placeholder="000000"');
    expect(environments.addFromLink).not.toHaveBeenCalled();
  });

  it.each([undefined, { platform: "darwin" }])("hides unavailable actions on browser and remote server pages", (bridge) => {
    const html = render(bridge);
    expect(html).toContain("requires the installed app");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });
});
