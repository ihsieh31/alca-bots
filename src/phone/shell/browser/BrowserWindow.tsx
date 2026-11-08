// The bot's browser, full screen: watch it work, pinch in to read, and take over when it needs a person's hands.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Globe, Hand, Keyboard, Layers, Plus, RotateCw, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { lightTap } from "../motion";
import { Sheet } from "../Sheet";
import { clampView, fitScale, homeView, TAP_ZOOM, toPage, zoomAt, type Size, type View } from "./geometry";
import { createInputQueue, LIVE_START, liveReducer, pageLabel, type LiveEvent, type LiveInput } from "./live";

const DRAG_START_PX = 8;
const TAP_MAX_MS = 450;
const DOUBLE_TAP_MS = 300;
const NOTICE_MS = 4000;
// Keeps a Backspace on an empty field visible: phones report nothing for it unless there is something to delete.
const KEYS_SENTINEL = "​";

type Point = { x: number; y: number };

function useLiveStream(botId: string, threadId: string, canvas: React.RefObject<HTMLCanvasElement | null>) {
  const [live, dispatch] = useReducer(liveReducer, LIVE_START);
  const [unavailable, setUnavailable] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const viewer = useRef<string | null>(null);
  viewer.current = live.viewerId;

  const act = useCallback((body: Record<string, unknown>) => api(`/api/bots/${botId}/browser/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewerId: viewer.current, ...body }),
  }), [botId]);

  useEffect(() => {
    const source = new EventSource(`/api/bots/${botId}/browser/live?threadId=${encodeURIComponent(threadId)}`);
    const on = (type: LiveEvent["type"]) => source.addEventListener(type, (event) => {
      dispatch({ type, ...JSON.parse((event as MessageEvent<string>).data) } as LiveEvent);
    });
    on("ready");
    on("status");
    on("url");
    on("tabs");
    on("control");
    let latest = 0;
    source.addEventListener("frame", (event) => {
      const frame = JSON.parse((event as MessageEvent<string>).data) as { seq: number; data: string; format: string };
      latest = frame.seq;
      const image = new Image();
      image.src = `data:image/${frame.format};base64,${frame.data}`;
      void image.decode().then(() => {
        const target = canvas.current;
        if (!target || frame.seq !== latest) return;
        if (target.width !== image.naturalWidth) target.width = image.naturalWidth;
        if (target.height !== image.naturalHeight) target.height = image.naturalHeight;
        target.getContext("2d")?.drawImage(image, 0, 0);
        setHasFrame(true);
      }).catch(() => {}).finally(() => {
        void act({ type: "ack", seq: frame.seq }).catch(() => {});
      });
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setUnavailable(true);
    };
    return () => source.close();
  }, [act, botId, canvas, threadId]);

  return { live, unavailable, hasFrame, act };
}

function TabsSheet({ tabs, onSelect, onClose: closeTab, onNew, onDismiss }: {
  tabs: Array<{ tabId: string; title: string; url: string; active: boolean }>;
  onSelect(tabId: string): void;
  onClose(tabId: string): void;
  onNew(): void;
  onDismiss(): void;
}) {
  return (
    <Sheet title={t("phone.browser.tabs")} onClose={onDismiss}>
      <div className="flex flex-col">
        {tabs.map((tab) => (
          <div key={tab.tabId} className="phone-browser-tab">
            <button type="button" className="phone-browser-tab-main" aria-current={tab.active ? "page" : undefined} onClick={() => onSelect(tab.tabId)}>
              <span className="phone-row-title truncate">{tab.title || pageLabel(tab.url) || t("phone.browser.title")}</span>
              <span className="phone-row-sub truncate">{pageLabel(tab.url)}</span>
            </button>
            <button type="button" className="phone-browser-icon" aria-label={t("phone.browser.closeTab")} onClick={() => closeTab(tab.tabId)}><X size={18} aria-hidden="true" /></button>
          </div>
        ))}
        <button type="button" className="phone-browser-tab-new" onClick={onNew}><Plus size={18} aria-hidden="true" />{t("phone.browser.newTab")}</button>
      </div>
    </Sheet>
  );
}

export function BrowserWindow({ botId, botName, threadId, onClose }: { botId: string; botName: string; threadId: string; onClose(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLInputElement>(null);
  const ripple = useRef<HTMLSpanElement>(null);
  const { live, unavailable, hasFrame, act } = useLiveStream(botId, threadId, canvas);
  const [notice, setNotice] = useState<string | null>(null);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);

  const say = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : t("phone.browser.failed"));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const run = useCallback((body: Record<string, unknown>) => {
    lightTap();
    void act(body).catch(say);
  }, [act, say]);
  const queue = useMemo(() => createInputQueue((events: LiveInput[]) => act({ type: "input_batch", events }), say), [act, say]);

  const page = useMemo<Size>(() => ({ width: live.width, height: live.height }), [live.width, live.height]);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const stageSize = useCallback((): Size => {
    const box = stage.current?.getBoundingClientRect();
    return { width: box?.width ?? 1, height: box?.height ?? 1 };
  }, []);

  const paint = useCallback((next: View, animate = false) => {
    const size = stageSize();
    const clamped = clampView(next, page, size);
    view.current = clamped;
    const target = canvas.current;
    if (!target) return;
    const fit = fitScale(page, size);
    target.style.width = `${page.width * fit}px`;
    target.style.height = `${page.height * fit}px`;
    target.style.transition = animate ? "transform 320ms var(--phone-ease)" : "none";
    target.style.transform = `translate3d(${clamped.x}px, ${clamped.y}px, 0) scale(${clamped.scale})`;
  }, [page, stageSize]);

  useLayoutEffect(() => {
    paint(homeView(page, stageSize()));
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => paint(view.current));
    observer.observe(element);
    return () => observer.disconnect();
  }, [page, paint, stageSize]);

  // Fingers on the stage. Refs, not state: this runs for every finger movement and only ever moves the canvas.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; at: number; moved: boolean; pinch: { distance: number; scale: number } | null; last: Point }>({ start: { x: 0, y: 0 }, at: 0, moved: false, pinch: null, last: { x: 0, y: 0 } });
  const lastTap = useRef(0);
  const local = useCallback((event: React.PointerEvent): Point => {
    const box = stage.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }, []);
  const two = () => {
    const [a, b] = Array.from(pointers.current.values()) as [Point, Point];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    stage.current?.setPointerCapture(event.pointerId);
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) {
      gesture.current = { start: point, at: Date.now(), moved: false, pinch: null, last: point };
    } else if (pointers.current.size === 2) {
      gesture.current.moved = true;
      gesture.current.pinch = { distance: two().distance, scale: view.current.scale };
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    const now = gesture.current;
    if (pointers.current.size >= 2 && now.pinch) {
      const { distance, center } = two();
      paint(zoomAt(view.current, Math.max(1, now.pinch.scale * (distance / now.pinch.distance)), center));
      return;
    }
    if (pointers.current.size !== 1) return;
    if (!now.moved && Math.hypot(point.x - now.start.x, point.y - now.start.y) < DRAG_START_PX) return;
    now.moved = true;
    const dx = point.x - now.last.x;
    const dy = point.y - now.last.y;
    now.last = point;
    if (live.controlling && view.current.scale === 1) {
      const at = toPage(now.start, view.current, page, stageSize());
      if (!at) return;
      const drawn = fitScale(page, stageSize());
      queue.push({ type: "input_mouse", eventType: "mouseWheel", ...at, deltaX: -dx / drawn, deltaY: -dy / drawn });
    } else {
      paint({ ...view.current, x: view.current.x + dx, y: view.current.y + dy });
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const point = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    const now = gesture.current;
    if (!point || now.moved || pointers.current.size || Date.now() - now.at > TAP_MAX_MS) return;
    if (live.controlling) {
      const at = toPage(point, view.current, page, stageSize());
      if (!at) return;
      lightTap();
      const mark = ripple.current;
      if (mark) {
        mark.style.left = `${point.x}px`;
        mark.style.top = `${point.y}px`;
        mark.classList.remove("phone-browser-ripple-go");
        void mark.offsetWidth;
        mark.classList.add("phone-browser-ripple-go");
      }
      queue.push({ type: "input_mouse", eventType: "mousePressed", ...at, clickCount: 1 });
      return;
    }
    const tapped = Date.now();
    if (tapped - lastTap.current < DOUBLE_TAP_MS) {
      lightTap();
      paint(view.current.scale > 1 ? homeView(page, stageSize()) : zoomAt(view.current, TAP_ZOOM, point), true);
      lastTap.current = 0;
    } else {
      lastTap.current = tapped;
    }
  };
  const onPointerCancel = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    gesture.current.moved = true;
  };

  const onKeysInput = (event: FormEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    if ((event.nativeEvent as InputEvent).isComposing) return;
    if (!field.value) queue.push({ type: "input_keyboard", eventType: "keyDown", key: "Backspace", modifiers: 0 });
    const text = field.value.replaceAll(KEYS_SENTINEL, "");
    if (text) queue.push({ type: "input_keyboard", eventType: "char", text });
    field.value = KEYS_SENTINEL;
  };

  const openKeyboard = () => {
    lightTap();
    const field = keys.current;
    if (!field) return;
    field.value = KEYS_SENTINEL;
    field.focus();
  };

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    const wanted = address?.trim();
    setAddress(null);
    if (!wanted) return;
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(wanted) ? wanted : `https://${wanted}`;
    try {
      if (/\s/.test(url)) throw new TypeError("spaces");
      void new URL(url);
      run({ type: "navigate", url });
    } catch {
      setNotice(t("phone.browser.badAddress"));
    }
  };

  const empty = unavailable || live.connected === false;
  const heldElsewhere = live.held && !live.controlling;
  const hint = live.controlling ? t("phone.browser.controlling", { name: botName })
    : heldElsewhere ? t("phone.browser.heldElsewhere")
    : t("phone.browser.watching", { name: botName });
  const tabCount = live.tabs.length;

  return (
    <div className="phone-browser" data-testid="phone-browser" role="dialog" aria-label={t("phone.browser.title")}>
      <header className="phone-browser-top">
        <button type="button" className="phone-browser-icon" aria-label={t("phone.browser.close")} onClick={onClose}><X size={21} aria-hidden="true" /></button>
        {address !== null ? (
          <form className="phone-browser-address" noValidate onSubmit={submitAddress}>
            <input autoFocus type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" enterKeyHint="go" value={address} placeholder={t("phone.browser.address")} aria-label={t("phone.browser.address")}
              onChange={(event) => setAddress(event.target.value)} onBlur={() => setAddress(null)} />
          </form>
        ) : (
          <button type="button" className="phone-browser-where" disabled={!live.controlling} onClick={() => setAddress(live.url)}>
            <Globe size={13} aria-hidden="true" /><span className="truncate">{pageLabel(live.url) || t("phone.browser.title")}</span>
          </button>
        )}
        <button type="button" className="phone-browser-icon relative" aria-label={t("phone.browser.tabs")} disabled={!live.controlling} onClick={() => { lightTap(); setTabsOpen(true); }}>
          <Layers size={19} aria-hidden="true" />
          {tabCount > 1 ? <span className="phone-browser-count">{tabCount}</span> : null}
        </button>
      </header>

      <div ref={stage} className="phone-browser-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
        <canvas ref={canvas} className={cn("phone-browser-canvas", hasFrame && !empty && "phone-browser-canvas-shown")} />
        <span ref={ripple} className="phone-browser-ripple" aria-hidden="true" />
        {!hasFrame || empty ? (
          <div className="phone-browser-empty" role="status">
            {empty ? null : <span className="phone-browser-spinner" aria-hidden="true" />}
            <p>{unavailable ? t("phone.browser.unavailable") : empty ? t("phone.browser.nothingOpen", { name: botName }) : t("phone.browser.connecting")}</p>
          </div>
        ) : null}
      </div>

      {notice ? <div className="phone-browser-notice" role="alert">{notice}</div> : null}

      <footer className="phone-browser-bottom">
        <p className="phone-browser-hint" role="status">{hint}</p>
        <input ref={keys} className="phone-browser-keys" tabIndex={-1} aria-label={t("phone.browser.keyboard")} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} enterKeyHint="go"
          onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} onInput={onKeysInput}
          onCompositionEnd={(event) => {
            const text = event.data;
            if (text) queue.push({ type: "input_keyboard", eventType: "char", text });
            event.currentTarget.value = KEYS_SENTINEL;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              queue.push({ type: "input_keyboard", eventType: "keyDown", key: event.key, modifiers: 0 });
            }
          }} />
        {live.controlling ? (
          <div className="phone-browser-tools">
            <button type="button" className="phone-browser-icon" aria-label={t("phone.browser.back")} onClick={() => run({ type: "back" })}><ArrowLeft size={20} aria-hidden="true" /></button>
            <button type="button" className="phone-browser-icon" aria-label={t("phone.browser.forward")} onClick={() => run({ type: "forward" })}><ArrowRight size={20} aria-hidden="true" /></button>
            <button type="button" className="phone-browser-icon" aria-label={t("phone.browser.reload")} onClick={() => run({ type: "reload" })}><RotateCw size={18} aria-hidden="true" /></button>
            <button type="button" className={cn("phone-browser-icon", typing && "phone-browser-icon-on")} aria-label={t("phone.browser.keyboard")} onPointerDown={(event) => event.preventDefault()} onClick={() => (typing ? keys.current?.blur() : openKeyboard())}><Keyboard size={20} aria-hidden="true" /></button>
            <button type="button" className="phone-browser-primary phone-browser-handback" onClick={() => run({ type: "release" })}>{t("phone.browser.handBack")}</button>
          </div>
        ) : (
          <button type="button" className="phone-browser-primary" disabled={empty || heldElsewhere || !live.viewerId} onClick={() => run({ type: "take" })}>
            <Hand size={17} aria-hidden="true" />{t("phone.browser.takeOver")}
          </button>
        )}
      </footer>

      {tabsOpen ? (
        <TabsSheet
          tabs={live.tabs}
          onDismiss={() => setTabsOpen(false)}
          onSelect={(tabId) => { setTabsOpen(false); run({ type: "tab-select", tabId }); }}
          onClose={(tabId) => run({ type: "tab-close", tabId })}
          onNew={() => { setTabsOpen(false); run({ type: "tab-new" }); }}
        />
      ) : null}
    </div>
  );
}
