import { liveSavePatch } from "../live-config.ts";
import * as boat from "../boat.ts";
import { boatCreateRecoverySnapshot, retireDeletedBoatCreate } from "../boat-create-idempotency.ts";
import { boatDeletionSnapshot } from "../boat-delete-journal.ts";
import { boatAccountResourceChangeError, vpsAliasResourceChangeError } from "../cloud-backend.ts";
import * as composio from "../composio.ts";
import {
  changedInstanceIds,
  engineLaunches,
  loadConfig,
  localVmMode,
  mergeOpenCodeProviderKeys,
  saveConfig,
  syncCredentialEnv,
  vpsSshAlias,
  type AppConfig,
} from "../config.ts";
import type { InstanceConfigMap, ModelSelection } from "../contracts.ts";
import type { RequestAuth } from "../request-auth.ts";
import { parseConfigPatchForPerson } from "../decider/config-errors.ts";
import { DECIDER_KEY_ERROR, deciderIncludedHere, deciderPatchKey, deciderSavePatch, deciderSharedKeyUsable, type Decider } from "../decider/index.ts";
import type { ProviderRegistry } from "../harness/registry.ts";
import { HOSTED_PROVIDER_SETTINGS_ERROR } from "../hosted-models.ts";
import { forgetKey } from "../key-rejections.ts";
import type { ComputerIdleTimer } from "../computer-idle.ts";
import { PROVIDER_KEY_KINDS } from "../provider-key-check.ts";
import type { SessionRegistry } from "../sessions.ts";
import type { SharedComputerControl } from "../shared-computer-control.ts";
import type { SharedComputers } from "../shared-computers.ts";
import { parseSkillMd } from "../skills.ts";
import type { Store } from "../store.ts";
import * as tts from "../tts/index.ts";
import * as vps from "../vps-computer.ts";
import { refusalBody, userError, userErrorFields } from "../user-errors.ts";
import type { ServerErrorBody } from "../../shared/server-text.ts";
import type { Postiz } from "../postiz/service.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BusyFlag {
  get(): boolean;
  set(busy: boolean): void;
}

export type RemoteComputerProvider = "box" | "vps";

export type ModelSelectionCheck = { ok: true; selection: ModelSelection } | ({ ok: false; status: number } & ServerErrorBody);

export type ConfigStatus = Record<string, unknown>;

export interface ConfigRouteDeps {
  store: Pick<Store, "bots" | "patchBot" | "clearVoiceSelections">;
  cfg: AppConfig;
  registry: Pick<ProviderRegistry, "get" | "forgetSnapshots">;
  sessions: Pick<SessionRegistry, "revalidateEmailSessions">;
  decider: Pick<Decider, "testKey">;
  sharedComputers: Pick<SharedComputers, "close">;
  sharedComputerControl: Pick<SharedComputerControl, "close">;
  hostedModels: boolean;
  cloudHome: boolean;
  lendingEnabled(): boolean;
  providerConfigs(): InstanceConfigMap;
  localVmIdleMs(): number;
  localVmIdles: { values(): Iterable<Pick<ComputerIdleTimer, "setIdleMs">> };
  localVmActiveThreads: { readonly size: number };
  localVmLifecycleBusy: { readonly size: number };
  localVmImageBusy: Pick<BusyFlag, "get">;
  localVmModeChangeBusy: Pick<BusyFlag, "set">;
  providerConfigBusy: BusyFlag;
  computerProviderConfigTransitions: Pick<Set<RemoteComputerProvider>, "add" | "delete">;
  managedBoatOwners(): boat.ManagedBoatOwner[];
  providerOperationConflict(provider: RemoteComputerProvider): string | null;
  perBotLocalVmCountForModeChange(): Promise<number | null>;
  checkedModelSelection(raw: unknown, current?: { selection: ModelSelection; busy: boolean }, requireAvailableModel?: boolean): ModelSelectionCheck;
  policyModelRefusal(instance: { instanceId: string; driverKind: string }): string | undefined;
  configStatus(): ConfigStatus;
  /** What this caller is shown: a client sees configured-or-not only; on a Team Cloud the profile is the caller's own. */
  configForAccess(status: ConfigStatus, auth: RequestAuth): unknown;
  /** A Team Cloud only: Settings → Profile saves the signed-in person's own profile, never the server's. False: nobody
   * signed in to save it for. */
  ownProfile?(auth: RequestAuth, profile: { name?: string; avatarUrl?: string; aboutMe?: string }): boolean;
  resyncOpenCodeProviderKeys(): void;
  revokeEngineCapabilities(engines: ReadonlySet<string>): void;
  reloadProviders(before: Record<string, unknown>): Promise<void>;
  broadcast(payload: Record<string, unknown>): void;
  drainQueuedSends(): void;
  /** Postiz: a key is checked at its address before it is saved, and the `postiz` server follows the saved key. */
  postiz?: Pick<Postiz, "configCheck" | "configSaved">;
}

export function createConfigRoutes(deps: ConfigRouteDeps): RouteHandler {
  const {
    store, cfg, registry, sessions, decider,
    sharedComputers, sharedComputerControl, hostedModels, cloudHome: CLOUD_HOME, lendingEnabled, providerConfigs,
    localVmIdleMs, localVmIdles, localVmActiveThreads, localVmLifecycleBusy, localVmImageBusy, localVmModeChangeBusy,
    providerConfigBusy, computerProviderConfigTransitions, managedBoatOwners, providerOperationConflict,
    perBotLocalVmCountForModeChange, checkedModelSelection, policyModelRefusal, configStatus,
    configForAccess, resyncOpenCodeProviderKeys, revokeEngineCapabilities, reloadProviders, broadcast, drainQueuedSends, ownProfile, postiz,
  } = deps;
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    // API keys are never echoed back: booleans only.
    if (method === "GET" && path === "/api/config") {
      return json(res, 200, configForAccess(configStatus(), auth));
    }
    if ((method === "PUT" || method === "PATCH") && path === "/api/config") {
      const body = await readBody(req);
      if (hostedModels && ["instances", "anthropic", "openai", "openrouter", "openaiCompat", "xai", "mistral", "cerebras", "groq", "greenference", "meta", "opencodeGo"].some(key => Object.hasOwn(body, key))) return json(res, 403, { error: HOSTED_PROVIDER_SETTINGS_ERROR });
      const patch = parseConfigPatchForPerson(body);
      if (patch.profile && ownProfile) {
        // The address is the verified claim's; a profile names no other.
        const { email: _email, ...own } = patch.profile;
        if (!ownProfile(auth, own)) return json(res, 403, { error: "Sign in to this team to have a profile." });
        delete patch.profile;
        if (!Object.keys(patch).length) {
          broadcast({ kind: "config", ...configStatus() });
          return json(res, 200, configForAccess(configStatus(), auth));
        }
      }
      if (CLOUD_HOME && (patch.signIn?.admins?.length || patch.signIn?.members?.length)) {
        return json(res, 403, { ...userError("serverError.cloud.personal"), code: "cloud_personal" });
      }
      if (patch.newBotDefaults) {
        if (patch.newBotDefaults.profile.modelSelection) {
          const checked = checkedModelSelection(patch.newBotDefaults.profile.modelSelection);
          if (!checked.ok) return json(res, checked.status, refusalBody(checked));
          patch.newBotDefaults.profile.modelSelection = checked.selection;
        }
        for (const skill of patch.newBotDefaults.skills) {
          const parsed = parseSkillMd(skill.text);
          if ("error" in parsed || parsed.name !== skill.name) return json(res, 400, { error: "Skill name does not match its contents" });
        }
      }
      if (hostedModels && patch.defaultModelSelection) {
        const checked = checkedModelSelection(patch.defaultModelSelection);
        if (!checked.ok) return json(res, checked.status, refusalBody(checked));
      }
      if (patch.automaticRecovery?.enabled) {
        const checked = checkedModelSelection(patch.automaticRecovery.backup, undefined, true);
        if (!checked.ok) return json(res, checked.status, refusalBody(checked));
        const target = registry.get(checked.selection.instanceId)!;
        if (!target.enabled) return json(res, 400, { error: "Enable the backup engine before selecting it for recovery." });
        const refusal = policyModelRefusal(target);
        if (refusal) return json(res, 403, { error: refusal, code: "managed_policy" });
        patch.automaticRecovery.backup = checked.selection;
      }
      if (!Object.keys(patch).length) return json(res, 400, { error: "nothing to save" });
      if (patch.decider) {
        const planned = deciderSavePatch(patch.decider, cfg.decider, { included: deciderIncludedHere(), shared: deciderSharedKeyUsable(cfg) });
        if (!planned.ok) return json(res, 400, refusalBody(planned));
        patch.decider = planned.patch;
      }
      const changingVoiceProvider = patch.tts?.provider !== undefined
        && patch.tts.provider !== tts.voiceProvider(cfg);
      if (changingVoiceProvider && patch.tts?.voice === undefined) {
        // Voice ids are provider-owned: never carry one from one catalog into another.
        patch.tts = { ...patch.tts, voice: "" };
      }
      if (changingVoiceProvider && patch.tts?.model === undefined) patch.tts = { ...patch.tts, model: "" };
      if (providerConfigBusy.get()) return json(res, 409, { error: "provider settings are already being updated" });
      if (patch.box?.token !== undefined) patch.box.token = patch.box.token.trim();
      const currentBoatToken = cfg.box?.token?.trim() ?? "";
      const nextBoatToken = patch.box?.token === undefined ? currentBoatToken : patch.box.token;
      const changingBoatToken = patch.box?.token !== undefined && nextBoatToken !== currentBoatToken;
      const currentVpsAlias = vpsSshAlias(cfg);
      const nextVpsAlias = patch.vps === undefined
        ? currentVpsAlias
        : vpsSshAlias({ ...cfg, vps: patch.vps });
      const changingVpsAlias = patch.vps !== undefined && nextVpsAlias !== currentVpsAlias;
      const transitioningProviders: RemoteComputerProvider[] = [
        ...(changingBoatToken ? ["box" as const] : []),
        ...(changingVpsAlias ? ["vps" as const] : []),
      ];
      providerConfigBusy.set(true);
      const changingLocalVmMode = patch.localVm?.mode !== undefined && patch.localVm.mode !== localVmMode(cfg);
      if (changingLocalVmMode) localVmModeChangeBusy.set(true);
      try {
        for (const provider of transitioningProviders) {
          const conflict = providerOperationConflict(provider);
          if (conflict) return json(res, 409, { error: conflict });
        }
        for (const provider of transitioningProviders) computerProviderConfigTransitions.add(provider);

        if (changingVpsAlias && currentVpsAlias) {
          const inventory = await vps.listManagedVpsComputers(
            { vps: { sshAlias: currentVpsAlias } },
            managedBoatOwners(),
          );
          if (!inventory.available) {
            return json(res, 503, {
              error: `${inventory.problem ?? "VPS computer inventory is unavailable"}. Keep the current SSH config alias and retry`,
            });
          }
          const resourceError = vpsAliasResourceChangeError(inventory.instances.length);
          if (resourceError) return json(res, 409, { error: resourceError });
        }

        let boatRecovery = changingBoatToken ? boatCreateRecoverySnapshot() : [];
        let boatDeletions = changingBoatToken ? boatDeletionSnapshot() : [];
        if (changingBoatToken && boatDeletions.length > 0 && !nextBoatToken) {
          return json(res, 409, {
            error: "finish or retry pending cloud computer deletion before removing the Boat account",
          });
        }
        let replacementProvedByDeletion = false;
        if (changingBoatToken && boatDeletions.length > 0 && nextBoatToken) {
          try {
            await boat.verifyBoatDeletionCredential({ box: { token: nextBoatToken } });
            replacementProvedByDeletion = true;
            // Re-snapshot: verification may have retired the deletion fence and its create receipt.
            boatRecovery = boatCreateRecoverySnapshot();
            boatDeletions = boatDeletionSnapshot();
          } catch (error) {
            return json(res, (error as { status?: number })?.status ?? 503, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        let currentBoatInventory: boat.ManagedBoatInventory | null = null;
        let replacingRejectedBoatToken = false;
        let currentBoatResources: Array<{ boxId: string; name: string }> | null = null;
        const journalBoatResources: Array<{ boxId: string; name: string }> = [];
        const deletingBoatIds = new Set(boatDeletions.map((entry) => entry.boxId));
        if (changingBoatToken && currentBoatToken) {
          currentBoatInventory = await boat.listManagedBoats(
            { box: { token: currentBoatToken } },
            managedBoatOwners(),
          );
          if (!currentBoatInventory.available) {
            replacingRejectedBoatToken = currentBoatInventory.credentialRejected === true && Boolean(nextBoatToken);
            if (!replacementProvedByDeletion && !replacingRejectedBoatToken) {
              return json(res, 503, {
                error: `${currentBoatInventory.problem ?? "cloud computer inventory is unavailable"}. Keep the current Boat account and retry`,
              });
            }
            // A rejected old key cannot authorize its own rotation.
            currentBoatInventory = null;
          }
          if (currentBoatInventory) {
            const currentById = new Map(
              currentBoatInventory.instances.map((instance) => [instance.boxId, { boxId: instance.boxId, name: instance.name }]),
            );
            for (const recovery of boatRecovery) {
              if (!recovery.boxId) continue;
              // The replacement credential already proved this exact deletion target.
              if (replacementProvedByDeletion && deletingBoatIds.has(recovery.boxId)) continue;
              const inspected = await boat.inspectBoatIdentity({ box: { token: currentBoatToken } }, recovery.boxId);
              if (!inspected.available) {
                return json(res, 503, {
                  error: `${inspected.problem ?? "a remembered cloud computer could not be verified"}. Keep the current Boat account and retry`,
                });
              }
              if (!inspected.identity) {
                // Reconcile stale receipts while the current credential still works.
                retireDeletedBoatCreate(recovery.boxId);
                continue;
              }
              const listed = currentById.get(inspected.identity.boxId);
              if (listed && listed.name !== inspected.identity.name) {
                return json(res, 503, { error: "boat.dev returned conflicting cloud computer identities; keep the current Boat account and retry" });
              }
              currentById.set(inspected.identity.boxId, inspected.identity);
              journalBoatResources.push(inspected.identity);
            }
            currentBoatResources = [...currentById.values()];
          }
        }

        if (changingLocalVmMode) {
          if (localVmActiveThreads.size > 0 || localVmLifecycleBusy.size > 0 || localVmImageBusy.get()) {
            return json(res, 409, { error: "stop Local VM turns and setup actions before changing the Local VM isolation mode" });
          }
          if (localVmMode(cfg) === "per-bot" && patch.localVm?.mode === "shared") {
            const existing = await perBotLocalVmCountForModeChange();
            if (existing === null) {
              return json(res, 409, {
                error: "start the container runtime and delete every per-bot VM before switching to shared mode",
              });
            }
            if (existing > 0) {
              return json(res, 409, {
                error: `delete the ${existing} per-bot Local VM${existing === 1 ? "" : "s"} before switching to shared mode`,
              });
            }
          }
        }
      const requestedComposioKey = patch.composio?.apiKey;
      if (requestedComposioKey !== undefined) {
        if (requestedComposioKey.trim()) {
          try {
            const prepared = await composio.prepareProjectSession(requestedComposioKey, cfg.composio);
            patch.composio = { ...patch.composio, ...prepared };
          } catch (error) {
            return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
          }
        } else {
          patch.composio = { ...patch.composio, apiKey: "", sessionId: "" };
        }
      }
      const postizRefusal = await postiz?.configCheck(patch);
      if (postizRefusal) return json(res, postizRefusal.status, { error: postizRefusal.error, code: postizRefusal.code, ...userErrorFields(postizRefusal) });
      const newBoatToken = patch.box?.token;
      if (newBoatToken?.trim()) {
        const check = await boat.verifyToken(newBoatToken);
        if (!check.ok) return json(res, 400, { error: check.message, ...(check.rejected ? { code: "key_rejected" } : {}) });
      }
      if (replacingRejectedBoatToken) {
        // An expired credential cannot authorize its own replacement: probe without adopting or retiring identities.
        const replacement = await boat.listManagedBoats(
          { box: { token: nextBoatToken } }, managedBoatOwners(), { adoptLegacy: false },
        );
        if (!replacement.available) return json(res, 503, { error: replacement.problem ?? "Could not verify the replacement Boat key. Your saved key and computers are unchanged." });
      }
      if (changingBoatToken && (!currentBoatToken || replacementProvedByDeletion || replacingRejectedBoatToken) && boatRecovery.length > 0) {
        if (!nextBoatToken) {
          return json(res, 409, { error: "restore the Boat account that owns the remembered cloud computers before clearing it" });
        }
        for (const recovery of boatRecovery) {
          if (!recovery.boxId) {
            return json(res, 409, { error: "finish reconciling pending cloud computer creation before changing the Boat account" });
          }
          if (replacementProvedByDeletion && deletingBoatIds.has(recovery.boxId)) continue;
          const inspected = await boat.inspectBoatIdentity({ box: { token: nextBoatToken } }, recovery.boxId);
          if (!inspected.available) {
            return json(res, 503, {
              error: `${inspected.problem ?? "a remembered cloud computer could not be verified"}. Retry with the Boat account that created it`,
            });
          }
          if (!inspected.identity || !(await boat.boatNameMatchesBot(recovery.botId, inspected.identity.name))) {
            return json(res, 409, { error: "that Boat token cannot access the remembered cloud computers from this installation" });
          }
        }
      }
      if (changingBoatToken && currentBoatInventory && currentBoatResources) {
        let replacementResources: Array<{ boxId: string; name: string }> | null = null;
        if (nextBoatToken) {
          const replacementInventory = await boat.listManagedBoats(
            { box: { token: nextBoatToken } },
            managedBoatOwners(),
            { adoptLegacy: false },
          );
          if (!replacementInventory.available) {
            return json(res, 503, {
              error: `${replacementInventory.problem ?? "cloud computer inventory is unavailable"}. Keep the current Boat account and retry`,
            });
          }
          replacementResources = replacementInventory.instances.map((instance) => ({
            boxId: instance.boxId,
            name: instance.name,
          }));
          const replacementById = new Map(
            replacementResources.map((instance) => [instance.boxId, { boxId: instance.boxId, name: instance.name }]),
          );
          for (const identity of journalBoatResources) {
            const inspected = await boat.inspectBoatIdentity({ box: { token: nextBoatToken } }, identity.boxId);
            if (!inspected.available) {
              return json(res, 503, {
                error: `${inspected.problem ?? "a remembered cloud computer could not be verified"}. Keep the current Boat account and retry`,
              });
            }
            if (!inspected.identity || inspected.identity.name !== identity.name) {
              return json(res, 409, { error: "the replacement Boat token does not access the same cloud computers" });
            }
            replacementById.set(inspected.identity.boxId, inspected.identity);
          }
          replacementResources = [...replacementById.values()];
        }
        const resourceError = boatAccountResourceChangeError(
          currentBoatResources,
          replacementResources,
        );
        if (resourceError) return json(res, 409, { error: resourceError });
      }
      // Validated against each voice provider's own credential, so no service is ever sent another's key.
      const newTts = patch.tts;
      if (newTts?.key?.trim()) {
        const check = await tts.verifyKey("elevenlabs", newTts.key.trim());
        if (!check.ok) return json(res, 400, { error: check.message });
      }
      if (newTts?.fishKey?.trim()) {
        const check = await tts.verifyKey("fish", newTts.fishKey.trim());
        if (!check.ok) return json(res, 400, { error: check.message });
      }
      if (newTts?.geminiKey !== undefined) newTts.geminiKey = newTts.geminiKey.trim();
      if (newTts?.geminiKey) {
        const check = await tts.verifyKey("gemini", newTts.geminiKey);
        if (!check.ok) return json(res, 400, { error: check.message });
      }
      const deciderKey = patch.decider ? deciderPatchKey(patch.decider, cfg.decider) : null;
      if (deciderKey) {
        const check = await decider.testKey(deciderKey.check);
        if (!check.ok && check.reason === "rejected") {
          return json(res, 400, { ...userError(DECIDER_KEY_ERROR[deciderKey.provider]), code: "decider_rejected" });
        }
      }
      // Observed again after the awaits: catches an operation that already held a claim.
      for (const provider of transitioningProviders) {
        const conflict = providerOperationConflict(provider);
        if (conflict) return json(res, 409, { error: conflict });
      }
      // Only the named keys change; merged with no await before the save.
      if (patch.opencodeGo?.providerKeys) {
        const merged = mergeOpenCodeProviderKeys(cfg, patch.opencodeGo.providerKeys);
        if (!merged.ok) return json(res, 400, { error: merged.error });
        patch.opencodeGo = { ...patch.opencodeGo, providerKeys: merged.keys };
      }
      const resetKeys = PROVIDER_KEY_KINDS.flatMap((kind) => {
        const next = patch[kind]?.key;
        return next === undefined ? [] : [cfg[kind]?.key, next];
      });
      const enginesBefore = engineLaunches(providerConfigs());
      const externalSecretStorage = url.searchParams.get("secretStorage") === "external";
      if (patch.live) patch.live = liveSavePatch(cfg.live, patch.live);
      // Before the provider commit, so a failed write never leaves a foreign voice id to speak.
      if (changingVoiceProvider) store.clearVoiceSelections();
      if (externalSecretStorage) {
        // Supplied credentials are already in the OS-encrypted store: tombstone them so no older plaintext survives the merge.
        const persisted = structuredClone(patch);
        if (persisted.xai?.key !== undefined) persisted.xai.key = "";
        if (persisted.composio?.apiKey !== undefined) persisted.composio.apiKey = "";
        if (persisted.box?.token !== undefined) persisted.box.token = "";
        if (persisted.opencodeGo?.apiKey !== undefined) persisted.opencodeGo.apiKey = "";
        if (persisted.tts?.key !== undefined) persisted.tts.key = "";
        if (persisted.tts?.fishKey !== undefined) persisted.tts.fishKey = "";
        if (persisted.tts?.geminiKey !== undefined) persisted.tts.geminiKey = "";
        if (persisted.decider?.key !== undefined) persisted.decider.key = "";
        if (persisted.decider?.openrouterKey !== undefined) persisted.decider.openrouterKey = "";
        if (persisted.decider?.workersAiToken !== undefined) persisted.decider.workersAiToken = "";
        if (persisted.imageGen?.key !== undefined) persisted.imageGen.key = "";
        if (persisted.imageGen?.customApiKey !== undefined) persisted.imageGen.customApiKey = "";
        if (persisted.imageGen?.geminiKey !== undefined) persisted.imageGen.geminiKey = "";
        if (persisted.live?.key !== undefined) persisted.live.key = "";
        if (persisted.treg?.key !== undefined) persisted.treg.key = "";
        if (persisted.postiz?.key !== undefined) persisted.postiz.key = "";
        saveConfig(persisted);
        syncCredentialEnv(patch);
        Object.assign(cfg, loadConfig());
      } else {
        saveConfig(patch);
        // loadConfig prefers env over the file for credentials, so the env must follow the save.
        syncCredentialEnv(patch);
        Object.assign(cfg, loadConfig());
      }
      for (const key of resetKeys) if (key) forgetKey(key);
      postiz?.configSaved(patch);
      // A saved key reaches an engine through the environment its status read uses, often with no reload.
      registry.forgetSnapshots();
      if (patch.localVm?.idleTimeoutMinutes !== undefined) {
        for (const idle of localVmIdles.values()) idle.setIdleMs(localVmIdleMs());
      }
      if (patch.signIn !== undefined) {
        sessions.revalidateEmailSessions();
        resyncOpenCodeProviderKeys();
      }
      if (!lendingEnabled()) {
        sharedComputers.close();
        sharedComputerControl.close();
      }
      const changedEngines = new Set(changedInstanceIds(enginesBefore, engineLaunches(providerConfigs())));
      // Revoked before any await: a changed engine's old children are invalid at once.
      revokeEngineCapabilities(changedEngines);
      // Commit failures wait until every mandatory effect has run: no journal failure may leave a bearer or stale engines active.
      let mandatoryError: unknown = null;
      if (changedEngines.size > 0) {
        try {
          await reloadProviders(enginesBefore);
        } catch (error) {
          mandatoryError = error;
        }
      }
      const status = configStatus();
      broadcast({ kind: "config", ...status });
      if (patch.threads !== undefined) {
        drainQueuedSends();
      }
      if (mandatoryError) throw mandatoryError;
      return json(res, 200, configForAccess(status, auth));
      } finally {
        for (const provider of transitioningProviders) computerProviderConfigTransitions.delete(provider);
        if (changingLocalVmMode) localVmModeChangeBusy.set(false);
        providerConfigBusy.set(false);
      }
    }
    return PASS;
  };
}
