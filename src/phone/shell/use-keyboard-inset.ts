import { useEffect } from "react";


/** How far the shell runs below what can be seen. Measured from the shell itself: on iOS, window.innerHeight can shrink with
 * the keyboard while the shell's fixed layout does not, which reads as no keyboard at all. */
export function keyboardCover(shellBottom: number, viewportTop: number, viewportHeight: number): number {
  return Math.max(0, Math.round(shellBottom - viewportTop - viewportHeight));
}

/** Publishes how much of the shell the on-screen keyboard covers as --phone-keyboard. */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      const shell = document.querySelector("[data-phone-shell]");
      const bottom = shell ? shell.getBoundingClientRect().bottom : window.innerHeight;
      const covered = keyboardCover(bottom, viewport.offsetTop, viewport.height);
      root.style.setProperty("--phone-keyboard", `${covered}px`);
      root.toggleAttribute("data-phone-keyboard", covered > 80);
      // iOS scrolls the page to reveal a focused field, even one already in view.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.removeProperty("--phone-keyboard");
      root.removeAttribute("data-phone-keyboard");
    };
  }, []);
}
