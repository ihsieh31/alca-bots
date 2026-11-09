import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { t } from "@/lib/i18n";
import { PUSH_MS, slide } from "./motion";
import { keepsSidewaysDrag, swipeIntent } from "./swipe-back";

const BACK_FRACTION = 0.34;
const BACK_VELOCITY = 0.5;

interface Drag {
  x: number;
  y: number;
  at: number;
  pointer: number;
  moving: boolean;
}

/** A screen pushed over the tabs. Enters from the right; a drag to the right takes it back. `leaving` plays the way out from
 * wherever the finger left it, then `onGone` removes it. */
export function PhoneScreen({ leaving, onBack, onGone, children }: { leaving: boolean; onBack(): void; onGone(): void; children: ReactNode }) {
  const screen = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const shell = () => screen.current?.closest<HTMLElement>("[data-phone-shell]") ?? null;
  const under = (progress: number | null) => {
    const element = shell();
    if (!element) return;
    if (progress === null) element.style.removeProperty("--phone-push");
    else element.style.setProperty("--phone-push", String(progress));
  };
  const following = (on: boolean) => {
    shell()?.toggleAttribute("data-following", on);
  };

  useLayoutEffect(() => {
    if (screen.current) void slide(screen.current, "translateX(100%)", "translateX(0)", PUSH_MS);
  }, []);

  const wasLeaving = useRef(false);
  useLayoutEffect(() => {
    if (!leaving || wasLeaving.current || !screen.current) return;
    wasLeaving.current = true;
    drag.current = null;
    following(false);
    under(null);
    void slide(screen.current, screen.current.style.transform || "translateX(0)", "translateX(100%)", PUSH_MS * 0.8).then(onGone);
  }, [leaving, onGone]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (leaving || event.pointerType === "mouse" || keepsSidewaysDrag(event.target, event.currentTarget)) return;
    drag.current = { x: event.clientX, y: event.clientY, at: event.timeStamp, pointer: event.pointerId, moving: false };
  }, [leaving]);
  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const now = drag.current;
    if (!now || now.pointer !== event.pointerId || !screen.current) return;
    const dx = event.clientX - now.x;
    if (!now.moving) {
      const intent = swipeIntent(dx, event.clientY - now.y);
      if (intent === "not-back") drag.current = null;
      if (intent !== "back") return;
      now.moving = true;
      now.x = event.clientX;
      now.at = event.timeStamp;
      following(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const travel = Math.max(0, dx);
    screen.current.style.transform = `translateX(${travel}px)`;
    under(1 - travel / screen.current.offsetWidth);
  }, []);
  const settle = useCallback((event: React.PointerEvent, canGoBack: boolean) => {
    const now = drag.current;
    if (!now || now.pointer !== event.pointerId || !screen.current) return;
    drag.current = null;
    if (!now.moving) return;
    const travel = Math.max(0, event.clientX - now.x);
    const velocity = travel / Math.max(1, event.timeStamp - now.at);
    following(false);
    if (canGoBack && (travel > screen.current.offsetWidth * BACK_FRACTION || velocity > BACK_VELOCITY)) {
      onBack();
    } else {
      under(null);
      void slide(screen.current, `translateX(${travel}px)`, "translateX(0)", PUSH_MS * 0.7);
    }
  }, [onBack]);

  return (
    <div
      ref={screen}
      className="phone-screen"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => settle(event, true)}
      onPointerCancel={(event) => settle(event, false)}
    >
      {children}
    </div>
  );
}

/** The back button, placed where a conversation's header leaves room for it. */
export function BackButton({ onBack }: { onBack(): void }) {
  return (
    <button type="button" aria-label={t("phone.shell.back")} className="phone-back" onClick={onBack}>
      <ChevronLeft size={22} aria-hidden="true" />
    </button>
  );
}
