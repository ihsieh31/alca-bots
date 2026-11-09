// When a sideways drag on a pushed screen means "go back".
const LOCK_PX = 10;
const SIDEWAYS_RATIO = 1.2;

export type SwipeIntent = "undecided" | "back" | "not-back";

export function swipeIntent(dx: number, dy: number): SwipeIntent {
  if (Math.abs(dy) >= LOCK_PX && Math.abs(dy) * SIDEWAYS_RATIO > Math.abs(dx)) return "not-back";
  if (dx <= -LOCK_PX) return "not-back";
  return dx >= LOCK_PX && dx > Math.abs(dy) * SIDEWAYS_RATIO ? "back" : "undecided";
}

const OWN_GESTURES = "[role=dialog], .phone-sheet-layer, .phone-browser, .phone-panel, input[type=range]";

/** Whether what the finger landed on needs a sideways drag for itself: a panel with its own gestures, or a wide code block. */
export function keepsSidewaysDrag(target: EventTarget | null, screen: Element): boolean {
  if (!(target instanceof Element) || target.closest(OWN_GESTURES)) return true;
  for (let element: Element | null = target; element && element !== screen; element = element.parentElement) {
    if (element.scrollWidth <= element.clientWidth) continue;
    const { overflowX } = getComputedStyle(element);
    if (overflowX === "auto" || overflowX === "scroll") return true;
  }
  return false;
}
