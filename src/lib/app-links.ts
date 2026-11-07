export const APP_NAME = "AlcaBots";
export const APP_REPOSITORY = "https://github.com/ihsieh31/alca-bots";
export const DOCS_URL = `${APP_REPOSITORY}/tree/main/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${APP_REPOSITORY}/blob/main/docs/approval-levels.md`;
export const PASSKEY_HELP_URL = "https://docs.alcabots.com/docs/troubleshooting/google-sign-in-cloud-browser";
export const FEEDBACK_URL = "https://discord.gg/9Wb8MEpXRs";
export const RELEASES_URL = `${APP_REPOSITORY}/releases`;
export const PRICING_URL = "https://www.alcabots.com/pricing";
export const CLOUD_PLAN_URL = "https://cloud.alcabots.com/cloud";
export function withSource(url: string, source: string): string {
  const target = new URL(url);
  target.searchParams.set("src", source);
  return target.href;
}
export const LICENSE_URL = `${APP_REPOSITORY}/blob/main/LICENSE`;
export const IOS_APP_STORE_URL = "https://apps.apple.com/in/app/alcabot/id6803387923";
export const ANDROID_APK_URL = `${APP_REPOSITORY}/releases/download/android-v1.5.0/AlcaBots.apk`;

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

export async function openExternalLink(url: string): Promise<void> {
  if (window.abot?.openExternal) {
    await window.abot.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** A browser hands a mailto: link to its own mail app; the desktop app's window may not navigate to one, so main opens it. */
export async function openEmailDraft(url: string): Promise<void> {
  if (window.abot) return openExternalLink(url);
  window.location.href = url;
}
