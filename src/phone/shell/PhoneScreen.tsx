import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { t } from "@/lib/i18n";
import { PUSH_MS, slide } from "./motion";

const EDGE_PX = 26;
const BACK_FRACTION = 0.34;
const BACK_VELOCITY = 0.5;

/** A screen pushed over the tabs. Enters from the right; dragging from the left edge takes it back. `leaving` plays the
 * way out, then `onGone` removes it. */
export function PhoneScreen({ leaving, onBack, onGone, children }: { leaving: boolean; onBack(): void; onGone(): void; children: ReactNode }) {
  const screen = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; at: number; pointer: number } | null>(null);

  const under = (progress: number | null) => {
    const shell = screen.current?.closest<HTMLElement>("[data-phone-shell]");
    if (!shell) return;
    if (progress === null) shell.style.removeProperty("--phone-push");
    else shell.style.setProperty("--phone-push", String(progress));
  };

  useLayoutEffect(() => {
    if (screen.current) void slide(screen.current, "translateX(100%)", "translateX(0)", PUSH_MS);
  }, []);

  const wasLeaving = useRef(false);
  useLayoutEffect(() => {
    if (!leaving || wasLeaving.current || !screen.current) return;
    wasLeaving.current = true;
    under(null);
    void slide(screen.current, screen.current.style.transform || "translateX(0)", "translateX(100%)", PUSH_MS * 0.8).then(onGone);
  }, [leaving, onGone]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.clientX > EDGE_PX || event.pointerType === "mouse") return;
    drag.current = { x: event.clientX, at: event.timeStamp, pointer: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!drag.current || !screen.current) return;
    const dx = Math.max(0, event.clientX - drag.current.x);
    screen.current.style.transform = `translateX(${dx}px)`;
    under(1 - dx / screen.current.offsetWidth);
  }, []);
  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (!drag.current || !screen.current) return;
    const dx = Math.max(0, event.clientX - drag.current.x);
    const velocity = dx / Math.max(1, event.timeStamp - drag.current.at);
    drag.current = null;
    if (dx > screen.current.offsetWidth * BACK_FRACTION || velocity > BACK_VELOCITY) {
      onBack();
    } else {
      under(null);
      void slide(screen.current, `translateX(${dx}px)`, "translateX(0)", PUSH_MS * 0.7);
    }
  }, [onBack]);

  return (
    <div ref={screen} className="phone-screen" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
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
