// Motion shared by the phone's screens. The curve settles the way a thrown sheet does; anyone who asked for less motion
// gets the end state at once.
export const EASE_OUT = "cubic-bezier(0.32, 0.72, 0, 1)";
export const PUSH_MS = 420;
export const SHEET_MS = 460;

export const reducedMotion = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs a transform animation and keeps the end state; finishes at once without motion. */
export function slide(element: HTMLElement, from: string, to: string, ms: number): Promise<void> {
  if (reducedMotion() || typeof element.animate !== "function") {
    element.style.transform = to;
    return Promise.resolve();
  }
  const animation = element.animate([{ transform: from }, { transform: to }], { duration: ms, easing: EASE_OUT, fill: "forwards" });
  return animation.finished.then(() => {
    element.style.transform = to;
    animation.cancel();
  }, () => {});
}

export const lightTap = (): void => {
  navigator.vibrate?.(6);
};
