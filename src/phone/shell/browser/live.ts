// The live browser view's state and the order input goes out in. The computer runs one action at a time and each takes
// a moment, so input that arrives meanwhile is sent together, with scrolling added up.

export interface LiveTab {
  tabId: string;
  title: string;
  url: string;
  active: boolean;
}

export interface LiveState {
  viewerId: string | null;
  connected: boolean | null;
  width: number;
  height: number;
  url: string;
  tabs: LiveTab[];
  held: boolean;
  controlling: boolean;
}

export const LIVE_START: LiveState = { viewerId: null, connected: null, width: 1280, height: 720, url: "", tabs: [], held: false, controlling: false };

export type LiveEvent =
  | { type: "ready"; viewerId: string }
  | { type: "status"; connected: boolean; viewportWidth: number; viewportHeight: number }
  | { type: "url"; url: string }
  | { type: "tabs"; tabs: LiveTab[] }
  | { type: "control"; held: boolean; controlling: boolean };

export function liveReducer(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case "ready":
      return { ...state, viewerId: event.viewerId };
    case "status":
      return { ...state, connected: event.connected, width: event.viewportWidth, height: event.viewportHeight };
    case "url":
      return { ...state, url: event.url };
    case "tabs":
      return { ...state, tabs: event.tabs };
    case "control":
      return { ...state, held: event.held, controlling: event.controlling };
  }
}

export const pageLabel = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export type LiveInput =
  | { type: "input_mouse"; eventType: "mousePressed"; x: number; y: number; clickCount: number }
  | { type: "input_mouse"; eventType: "mouseWheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "input_keyboard"; eventType: "char"; text: string }
  | { type: "input_keyboard"; eventType: "keyDown"; key: string; modifiers: number };

const MAX_BATCH = 64;
const MAX_WHEEL = 10_000;
const MAX_TEXT = 4096;

const clampWheel = (delta: number) => Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, delta));

function merged(last: LiveInput | undefined, next: LiveInput): LiveInput | null {
  if (last?.type === "input_mouse" && last.eventType === "mouseWheel" && next.type === "input_mouse" && next.eventType === "mouseWheel") {
    return { ...last, deltaX: clampWheel(last.deltaX + next.deltaX), deltaY: clampWheel(last.deltaY + next.deltaY) };
  }
  if (last?.type === "input_keyboard" && last.eventType === "char" && next.type === "input_keyboard" && next.eventType === "char" && last.text.length + next.text.length <= MAX_TEXT) {
    return { ...last, text: last.text + next.text };
  }
  return null;
}

export function createInputQueue(send: (events: LiveInput[]) => Promise<unknown>, onError: (error: unknown) => void) {
  let waiting: LiveInput[] = [];
  let sending = false;
  const flush = async () => {
    if (sending) return;
    sending = true;
    try {
      while (waiting.length) {
        const batch = waiting.slice(0, MAX_BATCH);
        waiting = waiting.slice(MAX_BATCH);
        await send(batch).catch((error: unknown) => {
          waiting = [];
          onError(error);
        });
      }
    } finally {
      sending = false;
    }
  };
  return {
    push(event: LiveInput) {
      const joined = merged(waiting[waiting.length - 1], event);
      if (joined) waiting[waiting.length - 1] = joined;
      else waiting.push(event);
      void flush();
    },
  };
}
