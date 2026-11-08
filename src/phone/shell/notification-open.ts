// Where a tapped notification wants to go. A closed app learns it from the address, a running one from the service worker.
import { useEffect, useState } from "react";

import { OPEN_MESSAGE } from "../sw-core";

export interface OpenTarget {
  botId?: string;
  threadId?: string;
  groupId?: string;
}

const FIELDS = ["botId", "threadId", "groupId"] as const;

export function openTargetFrom(search: string): OpenTarget | null {
  const query = new URLSearchParams(search);
  const target: OpenTarget = {};
  for (const field of FIELDS) {
    const value = query.get(`open.${field}`);
    if (value) target[field] = value;
  }
  return Object.keys(target).length ? target : null;
}

function takeFromAddress(): OpenTarget | null {
  const target = openTargetFrom(window.location.search);
  if (target) window.history.replaceState(window.history.state, "", window.location.pathname);
  return target;
}

export function useNotificationOpen(ready: boolean, open: (target: OpenTarget) => void): void {
  const [target, setTarget] = useState<OpenTarget | null>(takeFromAddress);

  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const heard = ({ data }: MessageEvent<OpenTarget & { type?: string }>) => {
      if (data?.type !== OPEN_MESSAGE) return;
      const next: OpenTarget = {};
      for (const field of FIELDS) {
        const value = data[field];
        if (value) next[field] = value;
      }
      setTarget(next);
    };
    worker.addEventListener("message", heard);
    return () => worker.removeEventListener("message", heard);
  }, []);

  useEffect(() => {
    if (!target || !ready) return;
    setTarget(null);
    open(target);
  }, [target, ready, open]);
}
