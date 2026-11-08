import { useEffect, useRef } from "react";
import { preloadConnectedApps } from "@/lib/connected-apps";
import { localDesktopPage } from "@/components/onboarding/WelcomeGate";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { sendDailySnapshot, SNAPSHOT_CHECK_MS, snapshotReady, type UsageSources } from "@/lib/usage-snapshot";
import { api, useStore, type ConfigStatus } from "@/state/store";

function browserSources(config: ConfigStatus | null): UsageSources {
  const abot = window.abot;
  const remoteClient = abot?.remoteClient?.active === true;
  const local = !remoteClient && localDesktopPage();
  return {
    // Background reads: the daily snapshot is nobody using a Cloud home (src/state/api.ts).
    request: (path) => api(path, { background: true }),
    connectedApps: () => preloadConnectedApps(false, true),
    cloudAccount: local ? abot?.cloudAccount ?? null : null,
    cloudPlan: !remoteClient && !local && config?.cloudHome === true ? abot?.cloudPlan ?? null : null,
    platform: navigator.userAgent.includes("Electron") ? "desktop" : "browser",
    remoteClient,
  };
}

/** The owner's daily usage snapshot: checked once the app is ready, then hourly, and sent at most once per UTC day. */
export function useUsageSnapshot(): void {
  const { state } = useStore();
  const owner = useOwnerOrAdmin();
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  const ready = owner === true && snapshotReady(state, window.abot?.remoteClient?.active !== true);
  useEffect(() => {
    if (!ready) return;
    const check = () => void sendDailySnapshot(latest.current, browserSources(latest.current.config));
    check();
    const timer = setInterval(check, SNAPSHOT_CHECK_MS);
    return () => clearInterval(timer);
  }, [ready]);
}
