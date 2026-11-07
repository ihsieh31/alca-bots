// Exact app-owned browser state that belongs in an encrypted full backup.
// Never include cookies, authentication tokens, connection caches or unknown keys.
export const WORKSPACE_BACKUP_CLIENT_KEYS = [
  "alca-drafts",
  "alca-draft-attachments",
  "alca-draft-send-ids",
  "alca-draft-channel-modes",
  "alca-skin",
  "alca-show-threads",
  "alca-show-run-card",
  "alca-send-key",
  "alca-color-user-bubbles",
  "alca-chat-width",
  "alcabots.sidebarDensity",
  "alcabots.sidebarToolsLayout",
  "alcabots.sidebarCollapsedSections.v1",
  "alcabots.sidebarSectionOrder.v1",
  "alca-analytics-opt-out",
  "alcabots.remote-voice.v1",
] as const;

export type WorkspaceBackupClientState = Partial<Record<(typeof WORKSPACE_BACKUP_CLIENT_KEYS)[number], string>>;
