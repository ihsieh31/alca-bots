import { useCallback, type MouseEvent } from "react";
import { PAGE_ID } from "../../shared/published-page";
import { openExternalLink } from "./app-links";

export const PAGES_DOMAIN = "alcabot.page";

/** A link to a page a bot published: https://<page id>.alcabot.page/… Never an app, chat or prompt link. */
export function isPublishedPageUrl(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase(), suffix = `.${PAGES_DOMAIN}`;
  return host.endsWith(suffix) && PAGE_ID.test(host.slice(0, -suffix.length));
}

/** Opens a link the way a published page's Open does: outside the chat (the system browser in the desktop app, a new tab
 * on the web). It never sends a message, starts a turn or opens a chat. */
export function usePageOpener(): (url: string) => void {
  return useCallback((url: string) => { void openExternalLink(url).catch(() => {}); }, []);
}

/** A page link's click opens it like the card's Open; a click its hover card already took stays taken. */
export function withPageOpen<T extends { onClick?: (event: MouseEvent<HTMLElement>) => void }>(href: string | undefined, open: (url: string) => void, anchor: T): T {
  if (!isPublishedPageUrl(href)) return anchor;
  return { ...anchor, onClick: (event: MouseEvent<HTMLElement>) => {
    anchor.onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    open(href);
  } };
}
