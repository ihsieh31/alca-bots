// The home tabs as one sideways strip: the browser's own snapping moves it under a swipe, and dragging along the tab bar
// moves it the same way. The strip's position is the only truth; the bar's indicator and the chosen tab follow from it.
import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { lightTap, reducedMotion } from "./motion";

const SETTLE_MS = 380;
const DRAG_START_PX = 6;
const BAR_SIDE_PADDING_PX = 10;

export const clampProgress = (progress: number, count: number): number => Math.min(count - 1, Math.max(0, progress));

/** Where a drag along the tab bar puts the strip: one tab's width of finger travel moves it one page. */
export function barDragProgress(from: number, travelPx: number, tabWidthPx: number, count: number): number {
  return clampProgress(from + travelPx / Math.max(1, tabWidthPx), count);
}

const settleCurve = (t: number): number => 1 - (1 - t) ** 4;

export function useTabPager<Tab>(tabs: readonly Tab[], tab: Tab, onSelect: (tab: Tab) => void) {
  const pager = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const index = tabs.indexOf(tab);
  const shownIndex = useRef(index);
  shownIndex.current = index;
  const settling = useRef<number | null>(null);
  const barDrag = useRef<{ pointer: number; x: number; from: number; moving: boolean } | null>(null);

  const progress = useCallback(() => {
    const strip = pager.current;
    return strip && strip.clientWidth ? strip.scrollLeft / strip.clientWidth : 0;
  }, []);
  const stopSettling = useCallback(() => {
    if (settling.current !== null) cancelAnimationFrame(settling.current);
    settling.current = null;
  }, []);
  // Snapping fights any scroll set from code, so it stays off until the strip is back on a page.
  const release = useCallback(() => {
    if (pager.current) pager.current.style.scrollSnapType = "";
  }, []);

  const settleOn = useCallback((target: number) => {
    const strip = pager.current;
    if (!strip) return;
    stopSettling();
    const to = target * strip.clientWidth;
    if (reducedMotion() || strip.scrollLeft === to) {
      strip.scrollLeft = to;
      release();
      return;
    }
    strip.style.scrollSnapType = "none";
    const from = strip.scrollLeft;
    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / SETTLE_MS);
      strip.scrollLeft = from + (to - from) * settleCurve(t);
      if (t < 1) {
        settling.current = requestAnimationFrame(step);
      } else {
        settling.current = null;
        release();
      }
    };
    settling.current = requestAnimationFrame(step);
  }, [release, stopSettling]);

  useEffect(() => {
    const strip = pager.current;
    if (!strip) return;
    const onScroll = () => {
      const now = progress();
      bar.current?.style.setProperty("--tab-index", String(now));
      if (settling.current !== null) return;
      const nearest = Math.round(clampProgress(now, tabs.length));
      if (nearest === shownIndex.current) return;
      shownIndex.current = nearest;
      lightTap();
      onSelect(tabs[nearest]!);
    };
    strip.addEventListener("scroll", onScroll, { passive: true });
    return () => strip.removeEventListener("scroll", onScroll);
  }, [onSelect, progress, tabs]);

  // Reached only by a tap: a swipe has already moved the strip by the time it changes the tab.
  useLayoutEffect(() => {
    if (!barDrag.current && Math.round(progress()) !== index) settleOn(index);
  }, [index, progress, settleOn]);

  useEffect(() => {
    const strip = pager.current;
    if (!strip || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (settling.current !== null || barDrag.current) return;
      strip.scrollLeft = shownIndex.current * strip.clientWidth;
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    bar.current?.style.setProperty("--tab-index", String(shownIndex.current));
    return stopSettling;
  }, [stopSettling]);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    barDrag.current = { pointer: event.pointerId, x: event.clientX, from: progress(), moving: false };
  }, [progress]);
  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    const drag = barDrag.current;
    const strip = pager.current;
    if (!drag || !strip || drag.pointer !== event.pointerId) return;
    const travel = event.clientX - drag.x;
    if (!drag.moving) {
      if (Math.abs(travel) < DRAG_START_PX) return;
      drag.moving = true;
      stopSettling();
      strip.style.scrollSnapType = "none";
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const tabWidth = (event.currentTarget.clientWidth - BAR_SIDE_PADDING_PX * 2) / tabs.length;
    strip.scrollLeft = barDragProgress(drag.from, travel, tabWidth, tabs.length) * strip.clientWidth;
  }, [stopSettling, tabs.length]);
  const onPointerEnd = useCallback((event: ReactPointerEvent) => {
    const drag = barDrag.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    barDrag.current = null;
    if (drag.moving) settleOn(Math.round(clampProgress(progress(), tabs.length)));
  }, [progress, settleOn, tabs.length]);

  return {
    pager,
    bar,
    barHandlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  };
}
