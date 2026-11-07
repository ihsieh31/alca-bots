import { describe, expect, it } from "vitest";
import { applyWorkspaceClientState, collectWorkspaceClientState } from "./workspace-backup-client";
import { SEND_KEY_KEY } from "./send-key";

function memory(values: Record<string, string>) {
  const entries = new Map(Object.entries(values));
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}

describe("full-backup browser state", () => {
  it("exports exact app drafts/preferences, never saved webhook credentials or auth/cache keys", () => {
    const storage = memory({ "alca-drafts": "draft", "alca-webhook-credentials": "private URL", "alca-skin": "daylight", "auth-token": "secret", "alca-connected-apps": "cached accounts", "alca-email-gate": "identity", "alca-pending-workspace-restore": "old" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "alca-drafts": "draft", "alca-skin": "daylight" });
  });

  it("replaces only allowlisted keys and clears old drafts absent from the backup", () => {
    const storage = memory({ "alca-drafts": "old", "alca-draft-attachments": "old attachment", "auth-token": "keep", "alca-webhook-credentials": "destination URL" });
    applyWorkspaceClientState({ "alca-drafts": "restored", "alca-show-threads": "false" }, storage);
    expect(Object.fromEntries(storage.entries)).toEqual({ "alca-drafts": "restored", "alca-show-threads": "false", "auth-token": "keep", "alca-webhook-credentials": "destination URL" });
  });

  it("carries the run card visibility choice in a workspace backup", () => {
    const storage = memory({ "alca-show-run-card": "0" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "alca-show-run-card": "0" });
    applyWorkspaceClientState({ "alca-show-run-card": "1" }, storage);
    expect(storage.getItem("alca-show-run-card")).toBe("1");
  });

  it("carries the send key choice in a workspace backup", () => {
    const storage = memory({ [SEND_KEY_KEY]: "mod-enter" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "alca-send-key": "mod-enter" });
    applyWorkspaceClientState({ "alca-send-key": "enter" }, storage);
    expect(storage.getItem(SEND_KEY_KEY)).toBe("enter");
  });

  it("carries the message color choice and leaves older backups opted out", () => {
    const storage = memory({ "alca-color-user-bubbles": "1" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "alca-color-user-bubbles": "1" });
    applyWorkspaceClientState({ "alca-color-user-bubbles": "0" }, storage);
    expect(storage.getItem("alca-color-user-bubbles")).toBe("0");
    applyWorkspaceClientState({}, storage);
    expect(storage.getItem("alca-color-user-bubbles")).toBeNull();
  });

  it("carries the chat width choice and clears it for older backups", () => {
    const storage = memory({ "alca-chat-width": "full" });
    expect(collectWorkspaceClientState(storage)).toEqual({ "alca-chat-width": "full" });
    applyWorkspaceClientState({ "alca-chat-width": "wide" }, storage);
    expect(storage.getItem("alca-chat-width")).toBe("wide");
    applyWorkspaceClientState({}, storage);
    expect(storage.getItem("alca-chat-width")).toBeNull();
  });

  it.each([null, [], { "auth-token": "injected" }, { "alca-webhook-credentials": "source URL" }, { "alca-drafts": 1 }])("rejects invalid client state before clearing anything (%j)", (value) => {
    const storage = memory({ "alca-drafts": "old", "auth-token": "keep" });
    expect(() => applyWorkspaceClientState(value, storage)).toThrow("Invalid backup browser state");
    expect(Object.fromEntries(storage.entries)).toEqual({ "alca-drafts": "old", "auth-token": "keep" });
  });

  it("rolls browser state back if restored values exceed storage quota", () => {
    const storage = memory({ "alca-drafts": "old", "alca-skin": "daylight", "auth-token": "keep" });
    const original = storage.setItem;
    storage.setItem = (key, value) => { if (value === "too large") throw new Error("quota"); original(key, value); };
    expect(() => applyWorkspaceClientState({ "alca-drafts": "too large" }, storage)).toThrow("quota");
    expect(Object.fromEntries(storage.entries)).toEqual({ "alca-drafts": "old", "alca-skin": "daylight", "auth-token": "keep" });
  });
});
