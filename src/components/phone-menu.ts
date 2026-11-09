import { createContext } from "react";

import type { SidebarMenuItem } from "./SidebarPopoverMenu";

export const PhoneShell = createContext(false);

const PHONE_MENU_KEYS = new Set(["find", "computer", "new-thread", "threads"]);

/** A conversation's menu on the phone: everyday actions only, with no keyboard hints or leading separator. */
export function phoneMenuItems(items: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return items
    .filter((item) => PHONE_MENU_KEYS.has(item.key))
    .map((item, index) => ({ ...item, trailing: undefined, ...(index === 0 ? { separatorBefore: false } : {}) }));
}
