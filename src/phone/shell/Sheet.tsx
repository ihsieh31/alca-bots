import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { t } from "@/lib/i18n";
import { SHEET_MS, slide } from "./motion";

const DISMISS_FRACTION = 0.28;
const DISMISS_VELOCITY = 0.55;

/** A bottom sheet: slides up over a dim backdrop, and follows the finger down from its handle to close. */
export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current || !panel.current) return;
    closing.current = true;
    const from = panel.current.style.transform || "translateY(0)";
    backdrop.current?.classList.remove("phone-backdrop-shown");
    void slide(panel.current, from, "translateY(100%)", SHEET_MS * 0.7).then(onClose);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!panel.current) return;
    void slide(panel.current, "translateY(100%)", "translateY(0)", SHEET_MS);
    backdrop.current?.classList.add("phone-backdrop-shown");
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const drag = useRef<{ startY: number; at: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    drag.current = { startY: event.clientY, at: event.timeStamp };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const dy = Math.max(0, event.clientY - drag.current.startY);
    panel.current.style.transform = `translateY(${dy}px)`;
  };
  const onPointerUp = (event: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const dy = Math.max(0, event.clientY - drag.current.startY);
    const velocity = dy / Math.max(1, event.timeStamp - drag.current.at);
    drag.current = null;
    if (dy > panel.current.offsetHeight * DISMISS_FRACTION || velocity > DISMISS_VELOCITY) close();
    else void slide(panel.current, `translateY(${dy}px)`, "translateY(0)", SHEET_MS * 0.7);
  };

  return createPortal(
    <div className="phone-sheet-layer">
      <div ref={backdrop} className="phone-backdrop" onClick={close} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="phone-sheet">
        <button
          type="button"
          aria-label={t("phone.shell.closeSheet")}
          className="phone-sheet-handle"
          onClick={close}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span />
        </button>
        <div className="phone-sheet-body">{children}</div>
      </div>
    </div>,
    document.querySelector("[data-phone-shell]") ?? document.body,
  );
}
