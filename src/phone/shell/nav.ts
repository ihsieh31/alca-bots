// The phone's navigation: one of the tabs, with screens pushed on top. Pushing adds a browser history entry, so the
// system's back button leaves a screen the way the screen's own back button does.
import { useCallback, useEffect, useReducer, useRef } from "react";

import { isAppleTouch, isStandalone } from "../push";

export type PhoneTab = "today" | "partners" | "work" | "more";
export type PhoneRoute = { kind: "chat" } | { kind: "routines" } | { kind: "apps" };

export interface NavState {
  tab: PhoneTab;
  stack: PhoneRoute[];
}

export type NavAction =
  | { type: "tab"; tab: PhoneTab }
  | { type: "push"; route: PhoneRoute }
  | { type: "depth"; depth: number };

export const NAV_START: NavState = { tab: "today", stack: [] };

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "tab":
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case "push":
      return { ...state, stack: [...state.stack, action.route] };
    case "depth":
      return action.depth >= state.stack.length ? state : { ...state, stack: state.stack.slice(0, Math.max(0, action.depth)) };
  }
}

const depthOf = (state: unknown): number => {
  const depth = (state as { phoneDepth?: unknown } | null)?.phoneDepth;
  return typeof depth === "number" ? depth : 0;
};

export interface PhoneNav extends NavState {
  selectTab(tab: PhoneTab): void;
  push(route: PhoneRoute): void;
  back(): void;
}

/** iOS (seen on an iPhone home-screen app, Nov 2026) answers an edge swipe with its own page-snapshot animation whenever
 * there is history to go back to, on top of the screen's own. With no entries the swipe is left to the screen. */
export const usesBrowserHistory = (apple: boolean, standalone: boolean): boolean => !(apple && standalone);

export function usePhoneNav(): PhoneNav {
  const [state, dispatch] = useReducer(navReducer, NAV_START);
  const depth = useRef(0);
  depth.current = state.stack.length;

  useEffect(() => {
    // A reload keeps this entry's state, but the screens it counted are gone.
    if (depthOf(window.history.state)) window.history.replaceState({ ...window.history.state, phoneDepth: 0 }, "");
    const popped = (event: PopStateEvent) => dispatch({ type: "depth", depth: depthOf(event.state) });
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, []);

  const push = useCallback((route: PhoneRoute) => {
    if (usesBrowserHistory(isAppleTouch(), isStandalone())) window.history.pushState({ phoneDepth: depth.current + 1 }, "");
    dispatch({ type: "push", route });
  }, []);
  const back = useCallback(() => {
    if (depth.current <= 0) return;
    if (usesBrowserHistory(isAppleTouch(), isStandalone())) window.history.back();
    else dispatch({ type: "depth", depth: depth.current - 1 });
  }, []);
  const selectTab = useCallback((tab: PhoneTab) => dispatch({ type: "tab", tab }), []);

  return { ...state, selectTab, push, back };
}
