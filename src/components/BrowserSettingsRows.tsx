import { useState } from "react";

import { browserAvailable, browserUnavailableReason, builtInBrowserEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { SettingRow, Switch } from "./SettingsPrimitives";

/** features.browser: whether bots may browse through ego lite on this installation. */
export function BuiltInBrowserRow() {
  const { state, dispatch } = useStore();
  const browser = builtInBrowserEnabled(state.config);
  const ready = browserAvailable(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (on: boolean) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", { method: "PATCH", body: JSON.stringify({ features: { browser: on } }) });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.experimental.browserAria")}
      subtitle={ready
        ? browser ? t("settings.experimental.browserOn") : t("settings.experimental.browserOff")
        : browserUnavailableReason(state.config)}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <Switch
        checked={browser}
        aria-label={t("settings.experimental.browserAria")}
        disabled={saving || (!browser && !ready)}
        onClick={() => void save(!browser)}
        className="disabled:cursor-wait disabled:opacity-50"
      />
    </SettingRow>
  );
}
