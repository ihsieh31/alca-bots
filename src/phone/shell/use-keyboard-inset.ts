import { useEffect } from "react";

/** Publishes how much of the layout the on-screen keyboard covers as --phone-keyboard, which iOS never takes out of
 * the layout viewport on its own. */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      root.style.setProperty("--phone-keyboard", `${covered}px`);
      root.toggleAttribute("data-phone-keyboard", covered > 80);
      // iOS scrolls the page to reveal a focused field, even one already in view.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--phone-keyboard");
      root.removeAttribute("data-phone-keyboard");
    };
  }, []);
}
