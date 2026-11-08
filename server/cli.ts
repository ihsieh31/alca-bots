// `alcabots` on the command line: run the server anywhere and pair devices to it.
//
//   alcabots setup [--data-dir ~/.alcabots]
//   alcabots start [serve options]
//   alcabots serve [--port 8799] [--data-dir ~/.alcabots] [--label "cab mini"]
//                     [--public-url https://host] [--tailscale | --domain HOST] [--no-pair]
//   alcabots pair  [--label "My MacBook"] [--client] [--public-url https://host]
//   alcabots sessions [revoke <id>]
//   alcabots status
//   alcabots phone [--daily]
//   alcabots run | send | wait | doctor | team apply | export | …
//
// This module only exports: alcabots.ts runs main(), so bundling this file into other entries never runs it twice.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { parseAllowList } from "./account-signin.ts";
import { appendAdminAction, flushAdminActivity, sharedSignIn } from "./admin-activity.ts";
import { bindDecisionRetention, decisionRetentionDays } from "./decision-log.ts";
import { hostedWorkspaceConfigured } from "./enterprise.ts";
import { resolveLoopbackTrust } from "./request-auth.ts";
import { restartPolicy } from "./restart.ts";
import { writeFileAtomic } from "./atomic.ts";
import { ensureCaddy, normalizeDomainOption, startCaddy, type RunningCaddy } from "./caddy.ts";
import { runServiceCommand } from "./service-cli.ts";
import { runSentinelCli } from "./sentinel/cli.ts";
import { runFleetCommand, type FleetInput } from "./fleet-cli.ts";
import { startFleetAgent } from "./fleet-agent.ts";
import { fleetLayout } from "./fleet.ts";
import { explainTailscaleFailure, tailscaleServe, tailscaleServeOff, tailscaleStatus, type TailscaleStatus } from "./tailscale.ts";
import { SetupCancelled, type SetupIo } from "./cli-prompts.ts";
import { HEADLESS_VERB_NAMES, USAGE } from "./cli-usage.ts";
import { runPhonePairing } from "./cli-phone.ts";
import { browserSignInLines, formatSessions, pairingBlock } from "./cli-pairing.ts";
import { parseDuration } from "./headless/args.ts";
import type { AppConfig } from "./config.ts";
const HERE = dirname(fileURLToPath(import.meta.url));

export interface CliOptions {
  command: "setup" | "start" | "serve" | "pair" | "sessions" | "status" | "phone" | "access" | "service" | "browser" | "fleet" | "help";
  port: number;
  dataDir: string;
  label?: string;
  publicUrl?: string;
  /** `serve --domain host`: HTTPS on your own domain through a managed Caddy. */
  domain?: string;
  tailscale: boolean;
  client: boolean;
  pair: boolean;
  revoke?: string;
  /** `access list|add|remove` */
  accessAction?: "list" | "add" | "remove";
  chatOnly?: boolean;
  /** `service install|uninstall` */
  serviceAction?: "install" | "uninstall";
  sentinel?: boolean;
  email?: string;
  /** `browser install | status` */
  browserAction?: "install" | "status";
  /** `fleet init|create|list|users|suspend|resume|delete|upgrade|agent` */
  fleetAction?: FleetInput["action"] | "agent";
  operator?: string;
  socket?: string;
  group?: string;
  slug?: string;
  admins?: string[];
  members?: string[];
  brandFile?: string;
  anthropicKeyFile?: string;
  cap?: number;
  licenseKey?: string;
  memory?: string;
  dryRun?: boolean;
  yes?: boolean;
  keepData?: boolean;
  fleetUserAction?: "add" | "remove";
  json: boolean;
  /** Explicitly ignore saved remote access for this launch. */
  local?: boolean;
  open?: boolean;
  guided?: boolean;
  /** `pair --ttl 24h`: how long the code stays open. */
  pairTtlMs?: number;
}

const COMMANDS = ["setup", "start", "serve", "pair", "sessions", "status", "phone", "access", "service", "browser", "fleet", "help", "--help", "-h"];

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions | { error: string } {
  const implicitStart = !argv.length || (argv[0]!.startsWith("--") && argv[0] !== "--help");
  const [command = "start", ...rest] = implicitStart ? ["start", ...argv] : argv;
  if (!COMMANDS.includes(command)) {
    return { error: `unknown command "${command}"` };
  }
  const options: CliOptions = {
    command: command === "--help" || command === "-h" ? "help" : (command as CliOptions["command"]),
    port: Number(env.ALCA_PORT || 8799),
    dataDir: env.ALCA_DATA_DIR || join(homedir(), ".alcabots"),
    tailscale: false,
    client: false,
    pair: true,
    json: false,
    chatOnly: false,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const value = () => {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    try {
      if (arg === "--port") options.port = Number(value());
      else if (arg === "--data-dir") options.dataDir = resolve(value());
      else if (arg === "--label") options.label = value();
      else if (arg === "--public-url") options.publicUrl = value().replace(/\/+$/, "");
      else if (arg === "--tailscale") options.tailscale = true;
      else if (arg === "--domain") {
        const domain = normalizeDomainOption(value());
        if (typeof domain !== "string") return domain;
        options.domain = domain;
      }
      else if (arg === "--client" || (options.command === "phone" && arg === "--daily")) options.client = true;
      else if (options.command === "pair" && arg === "--ttl") options.pairTtlMs = parseDuration(value(), "--ttl", { min: 60_000 });
      else if (arg === "--no-pair") options.pair = false;
      else if (arg === "--no-open") options.open = false;
      else if (arg === "--local") options.local = true;
      else if (arg === "--json") options.json = true;
      else if (arg === "--email") options.email = value();
      else if (options.command === "sessions" && arg === "revoke") options.revoke = value();
      else if (options.command === "access" && !options.accessAction && (arg === "list" || arg === "add" || arg === "remove")) {
        options.accessAction = arg;
        if (arg !== "list") options.email = value();
      } else if (options.command === "access" && arg === "--chat-only") options.chatOnly = true;
      else if (options.command === "service" && !options.serviceAction && (arg === "install" || arg === "uninstall")) options.serviceAction = arg;
      else if (options.command === "service" && arg === "--sentinel") options.sentinel = true;
      else if (options.command === "browser" && (arg === "install" || arg === "status")) options.browserAction = arg;
      else if (options.command === "fleet" && !options.fleetAction && ["init", "create", "list", "users", "suspend", "resume", "delete", "upgrade", "agent"].includes(arg)) options.fleetAction = arg as FleetInput["action"] | "agent";
      else if (options.command === "fleet" && options.fleetAction && !["init", "list", "upgrade", "agent"].includes(options.fleetAction) && !options.slug && !arg.startsWith("--")) options.slug = arg;
      else if (options.command === "fleet" && arg === "--operator") options.operator = value();
      else if (options.command === "fleet" && arg === "--socket") options.socket = value();
      else if (options.command === "fleet" && arg === "--group") options.group = value();
      else if (options.command === "fleet" && options.fleetAction === "users" && options.slug && !options.fleetUserAction && (arg === "add" || arg === "remove")) { options.fleetUserAction = arg; options.email = value(); }
      else if (options.command === "fleet" && arg === "--admin") options.admins = [...(options.admins ?? []), value()];
      else if (options.command === "fleet" && arg === "--member") options.members = [...(options.members ?? []), value()];
      else if (options.command === "fleet" && arg === "--brand") options.brandFile = resolve(value());
      else if (options.command === "fleet" && arg === "--anthropic-key-file") options.anthropicKeyFile = resolve(value());
      else if (options.command === "fleet" && arg === "--cap") options.cap = Number(value());
      else if (options.command === "fleet" && arg === "--license-key") options.licenseKey = value();
      else if (options.command === "fleet" && arg === "--memory") options.memory = value();
      else if (options.command === "fleet" && arg === "--dry-run") options.dryRun = true;
      else if (options.command === "fleet" && arg === "--yes") options.yes = true;
      else if (options.command === "fleet" && arg === "--keep-data") options.keepData = true;
      else if (options.command === "fleet" && arg === "--chat-only") options.chatOnly = true;
      else return { error: `unknown argument "${arg}"` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) return { error: "--port must be 1-65535" };
  if (options.publicUrl && !/^https?:\/\//.test(options.publicUrl)) return { error: "--public-url must start with http:// or https://" };
  if (options.command === "access" && !options.accessAction) return { error: "access needs one of: list, add EMAIL [--chat-only], remove EMAIL" };
  if (options.command === "service" && !options.serviceAction) return { error: "service needs one of: install [the same options as serve], uninstall" };
  if (options.domain && (options.tailscale || options.publicUrl)) return { error: "--domain already gives the server its address; drop --tailscale and --public-url" };
  if (options.local && (options.tailscale || options.publicUrl)) return { error: "--local cannot be combined with a remote-access option" };
  if (options.command === "browser" && !options.browserAction) return { error: "browser needs an action: install or status" };
  if (options.command === "fleet") {
    if (!options.fleetAction) return { error: "fleet needs one of: init --domain HOST [--operator USER], create NAME --admin EMAIL, list, users NAME add|remove EMAIL, suspend NAME, resume NAME, delete NAME --yes, upgrade, agent" };
    if (["create", "users", "suspend", "resume", "delete"].includes(options.fleetAction) && !options.slug) return { error: `fleet ${options.fleetAction} needs a workspace name` };
    if (options.fleetAction === "users" && !options.fleetUserAction) return { error: "fleet users needs: NAME add|remove EMAIL [--chat-only]" };
    if (options.cap !== undefined && (!Number.isFinite(options.cap) || options.cap < 0)) return { error: "--cap must be a dollar amount of 0 or more" };
  }
  return options;
}

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
  ask(question: string): Promise<string>;
}

export function defaultIo(): CliIo {
  return {
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}

export function serverVersion(here = HERE): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
    const version = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "version") : undefined;
    return typeof version === "string" && version ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** On a service-trust server: the secret `serve` handed the server it started, which opens its pairing route. */
let serveOwnerToken: string | undefined;

async function api(port: number, path: string, init: { method?: string; body?: string } = {}): Promise<{ status: number; body: any }> {
  // x-alcabots-cli names the tool in the activity log; on loopback it grants nothing.
  const headers: Record<string, string> = { "content-type": "application/json", "x-alcabots-cli": "1", ...(serveOwnerToken ? { "x-alcabots-cli-owner": serveOwnerToken } : {}) };
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: init.method, body: init.body, headers, signal: AbortSignal.timeout(3000) });
  const body: unknown = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export const SERVICE_TRUST_HELP = "This server does not treat commands on this computer as its owner (ALCA_LOOPBACK_TRUST=service, or a hosted workspace), so it will not pair devices or list sessions for them. Sign in as an admin and use Settings → Remote access, let people sign in with their email (alcabots access add you@example.com), or restart the server with ALCA_LOOPBACK_TRUST=owner.";

function refusedAsService(status: number, body: any): boolean {
  return status === 403 && typeof body?.error === "string" && /shared server|Sign in through the workspace portal/.test(body.error);
}

async function serverUp(port: number, pid?: number): Promise<boolean> {
  try {
    const { status, body } = await api(port, "/api/health");
    return status === 200 && body?.app === "alcabots" && (pid === undefined || body.pid === pid);
  } catch {
    return false;
  }
}

/** Never attach to another workspace just because it listens on the requested port. */
export async function isWorkspaceRunning(options: CliOptions): Promise<boolean> {
  try {
    const { status, body } = await api(options.port, "/api/health");
    if (status !== 200 || body?.app !== "alcabots") return false;
    const expected = readFileSync(join(options.dataDir, "environment-id"), "utf8").trim();
    const descriptor = await api(options.port, "/.well-known/alcabots/environment");
    return /^[0-9a-f-]{36}$/i.test(expected) && descriptor.status === 200 && descriptor.body?.environmentId === expected;
  } catch { return false; }
}

/** No shell commands, credentials or remote URLs go to the OS URL opener. */
export async function openDashboard(port: number, env = process.env): Promise<boolean> {
  if (env.SSH_CONNECTION || env.SSH_TTY || (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY)) return false;
  const url = `http://127.0.0.1:${port}`;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { child.kill(); done(false); }, 3000);
    child.once("error", () => { clearTimeout(timer); done(false); });
    child.once("exit", (code) => { clearTimeout(timer); done(code === 0); });
  });
}

/** Only a bare public https origin may be saved and reused: no credentials, path, query or loopback host. */
function httpsOrigin(raw: string): string | null {
  const value = raw.trim();
  // Control characters are refused before URL parsing can silently remove them.
  // eslint-disable-next-line no-control-regex
  if (!/^https:\/\/[^/]/i.test(value) || /[\s\u0000-\u001f\u007f\\?#@]/.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") return null;
    if (!host || host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host.startsWith("127.")) return null;
    if (host === "[::]" || host === "[::1]" || /^\[::ffff:(?:0:0|7f[0-9a-f]{2}:[0-9a-f]+)\]$/.test(host)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function applyStartupPreferences(options: CliOptions, saved: AppConfig["cliStartup"]): CliOptions {
  if (options.local) return { ...options, tailscale: false, publicUrl: undefined };
  if (!saved || options.tailscale || options.publicUrl) return options;
  if (saved.access === "public-url" && (!saved.publicUrl || !httpsOrigin(saved.publicUrl))) {
    throw new Error("The saved public address is not a valid HTTPS origin. Run alcabots setup to correct it, or alcabots --local to start only on this computer.");
  }
  return {
    ...options,
    tailscale: saved.access === "tailscale",
    publicUrl: saved.access === "public-url" ? saved.publicUrl : undefined,
  };
}

async function mintPairing(port: number, options: { label?: string; client?: boolean; publicUrl?: string; guided?: boolean; ttlMs?: number }): Promise<string> {
  const request = { ...(options.label ? { label: options.label } : {}), ...(options.client ? { scopes: ["client"] } : {}), ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}) };
  const { status, body } = await api(port, "/api/auth/pairing", { method: "POST", body: JSON.stringify(request) });
  if (refusedAsService(status, body)) throw new Error(SERVICE_TRUST_HELP);
  if (status !== 200) throw new Error(`server refused to mint a pairing code: ${typeof body?.error === "string" ? body.error : status}`);
  const url = options.publicUrl ? `${options.publicUrl}/pair#code=${body.code}` : typeof body.url === "string" ? body.url : null;
  const localUrl = `http://127.0.0.1:${port}/pair#code=${body.code}`;
  if (options.guided && localUrl) return browserSignInLines(localUrl, body.code, body.expiresAt);
  return pairingBlock({ code: body.code, url, localUrl, expiresAt: body.expiresAt, hint: typeof body.hint === "string" ? body.hint : null });
}

export async function runPair(options: CliOptions): Promise<number> {
  if (!(await serverUp(options.port))) {
    console.error(`no AlcaBots server on http://127.0.0.1:${options.port}; start one with \`alcabots serve\` or set ALCA_PORT`);
    return 1;
  }
  console.log(await mintPairing(options.port, { label: options.label, client: options.client, publicUrl: options.publicUrl, ttlMs: options.pairTtlMs }));
  if (options.client) console.log("(client scope: chat and approvals only; cannot change settings or pair others)");
  return 0;
}

export async function runSessions(options: CliOptions): Promise<number> {
  if (!(await serverUp(options.port))) {
    console.error(`no AlcaBots server on http://127.0.0.1:${options.port}`);
    return 1;
  }
  if (options.revoke) {
    const { status, body } = await api(options.port, `/api/auth/sessions/${encodeURIComponent(options.revoke)}`, { method: "DELETE" });
    if (refusedAsService(status, body)) {
      console.error(SERVICE_TRUST_HELP);
      return 1;
    }
    if (status !== 200) {
      console.error(`could not revoke: ${typeof body?.error === "string" ? body.error : status}`);
      return 1;
    }
    console.log(`revoked ${options.revoke}: that device is signed out and its stream is closed`);
    return 0;
  }
  const { status, body } = await api(options.port, "/api/auth/sessions");
  if (refusedAsService(status, body)) {
    console.error(SERVICE_TRUST_HELP);
    return 1;
  }
  if (status !== 200) {
    console.error(`could not list sessions: ${typeof body?.error === "string" ? body.error : status}`);
    return 1;
  }
  const sessions: Array<{ id: string; label: string; scopes: string[]; lastSeenAt: number; expiresAt: number }> = Array.isArray(body?.sessions) ? body.sessions : [];
  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return 0;
  }
  if (!sessions.length) {
    console.log("no paired devices yet: run `alcabots pair`");
    return 0;
  }
  console.log(formatSessions(sessions));
  return 0;
}

export async function runStatus(options: CliOptions, io: CliIo = defaultIo()): Promise<number> {
  let code = 0;
  try {
    const res = await fetch(`http://127.0.0.1:${options.port}/.well-known/alcabots/environment`);
    const body: any = await res.json();
    io.log(options.json ? JSON.stringify(body, null, 2) : `${body.label} · AlcaBots ${body.version} on ${body.platform} · id ${body.environmentId}`);
  } catch {
    io.error(`no AlcaBots server on http://127.0.0.1:${options.port}`);
    code = 1;
  }
  return code;
}

/** Edits the sign-in allow-list in config.json, server live or stopped (read per request); ALCA_SIGNIN_EMAILS wins when set. */
export async function runAccess(options: CliOptions, io: CliIo = defaultIo()): Promise<number> {
  const file = join(options.dataDir, "config.json");
  let raw: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      raw = Object.fromEntries(Object.entries(parsed));
    } catch (error) {
      io.error(`${file} could not be read (${message(error)}); fix it before changing who can sign in`);
      return 1;
    }
  }
  const current = typeof raw.signIn === "object" && raw.signIn !== null ? Object(raw.signIn) : {};
  const list = (value: unknown) => parseAllowList(Array.isArray(value) ? value.map(String).join(",") : "");
  const admins = list(Reflect.get(current, "admins"));
  const members = list(Reflect.get(current, "members"));
  const overridden = process.env.ALCA_SIGNIN_EMAILS !== undefined || process.env.ALCA_SIGNIN_MEMBER_EMAILS !== undefined;
  const write = async (next: { admins: string[]; members: string[] }) => {
    mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(file, `${JSON.stringify({ ...raw, signIn: next }, null, 2)}\n`, { mode: 0o600 });
    if (!sharedSignIn({ admins, members }) && !sharedSignIn(next) && !hostedWorkspaceConfigured()) return;
    const decisions = raw.decisions && typeof raw.decisions === "object" ? (raw.decisions as { retentionDays?: unknown }).retentionDays : undefined;
    bindDecisionRetention(() => decisionRetentionDays(typeof decisions === "number" ? decisions : undefined));
    const changed = (["admins", "members"] as const).filter((key) => next[key].join(",") !== (key === "admins" ? admins : members).join(","));
    appendAdminAction(options.dataDir, {
      category: "people", action: "people.update", target: { kind: "settings" }, actor: { kind: "cli" },
      changed: changed.map((key) => `signIn.${key}`),
      before: Object.fromEntries(changed.map((key) => [`signIn.${key}`, key === "admins" ? admins : members])),
      after: Object.fromEntries(changed.map((key) => [`signIn.${key}`, next[key]])),
    });
    await flushAdminActivity(options.dataDir);
  };
  if (options.accessAction === "list") {
    if (!admins.length && !members.length) {
      io.log("nobody can sign in with an email yet; pairing codes only. Add someone with: alcabots access add you@example.com");
      return 0;
    }
    for (const entry of admins) io.log(`${entry.padEnd(40)} full access`);
    for (const entry of members) io.log(`${entry.padEnd(40)} chat and approvals`);
    if (overridden) io.log("(ALCA_SIGNIN_EMAILS / ALCA_SIGNIN_MEMBER_EMAILS are set in the environment and win over this list while the server runs)");
    return 0;
  }
  const entry = (options.email ?? "").trim().toLowerCase();
  if (!entry || (!entry.startsWith("@") && !entry.includes("@")) || /\s/.test(entry)) {
    io.error("give an email address, or @domain for everyone at that domain");
    return 2;
  }
  const without = (items: string[]) => items.filter((item) => item !== entry);
  if (options.accessAction === "remove") {
    if (!admins.includes(entry) && !members.includes(entry)) {
      io.error(`${entry} is not on the list`);
      return 1;
    }
    await write({ admins: without(admins), members: without(members) });
    io.log(`${entry} can no longer sign in (existing sessions stay until they expire or are revoked with \`alcabots sessions revoke\`)`);
    return 0;
  }
  await write(options.chatOnly ? { admins: without(admins), members: [...without(members), entry] } : { admins: [...without(admins), entry], members: without(members) });
  io.log(`${entry} can sign in at /pair with an emailed code (${options.chatOnly ? "chat and approvals" : "full access"})`);
  if (overridden) io.log("note: ALCA_SIGNIN_EMAILS / ALCA_SIGNIN_MEMBER_EMAILS are set in the environment and win over this list while the server runs");
  return 0;
}

export async function runBrowser(options: CliOptions, io: CliIo = defaultIo()): Promise<number> {
  const { egoBrowserStatus } = await import("./ego-browser.ts");
  const status = egoBrowserStatus();
  if (status.kind === "ready") {
    io.log(`browser: ego lite (${status.path})`);
    return 0;
  }
  if (options.browserAction === "status") io.log(`browser: unavailable. ${status.reason}`);
  else io.error(`${status.reason} Then restart AlcaBots, or set ALCA_EGO_BROWSER_PATH to the ego-browser command.`);
  return 1;
}

export function serverEntry(here = HERE): { command: string; args: string[]; staticDir: string | null; skillsDir: string | null } {
  const bundled = join(here, "index.js");
  const root = resolve(here, "..");
  if (existsSync(bundled)) {
    const staticDir = [join(root, "dist"), join(here, "..", "ui")].find((d) => existsSync(join(d, "index.html"))) ?? null;
    const skillsDir = existsSync(join(root, "skills")) ? join(root, "skills") : null;
    return { command: process.execPath, args: [bundled], staticDir, skillsDir };
  }
  const source = join(here, "index.ts");
  const staticDir = existsSync(join(root, "dist", "index.html")) ? join(root, "dist") : null;
  return { command: process.execPath, args: ["--experimental-strip-types", source], staticDir, skillsDir: existsSync(join(root, "skills")) ? join(root, "skills") : null };
}

export async function runServe(options: CliOptions, log: (line: string) => void = console.log): Promise<number> {
  const { egoBrowserStatus } = await import("./ego-browser.ts");
  if (await serverUp(options.port)) {
    console.error(`something already answers on http://127.0.0.1:${options.port}; use \`alcabots pair\` against it, or --port for a second server`);
    return 1;
  }
  let publicUrl = options.publicUrl;
  let tailscale: TailscaleStatus | null = null;
  if (options.tailscale) {
    const probe = await tailscaleStatus();
    if ("failure" in probe) {
      console.error(`--tailscale: ${explainTailscaleFailure(probe.failure)}`);
      return 1;
    }
    tailscale = probe.status;
  }
  let caddyBinary: string | null = null;
  if (options.domain) {
    try {
      caddyBinary = await ensureCaddy({ dataDir: options.dataDir, log });
    } catch (error) {
      console.error(`--domain: ${message(error)}`);
      return 1;
    }
    publicUrl = `https://${options.domain}`;
  }
  const entry = serverEntry();
  if (!entry.staticDir) log("note: no built UI found next to the server; the API runs but browsers get no page (build with `pnpm exec vite build`)");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ALCA_DATA_DIR: options.dataDir,
    ALCA_PORT: String(options.port),
    ALCA_WEBHOOK_PORT: process.env.ALCA_WEBHOOK_PORT || String(options.port + 1),
  };
  if (options.local) delete env.ALCA_PUBLIC_URL;
  // The per-launch secret goes over stdin, not the environment that every engine the server starts inherits.
  const serviceTrust = resolveLoopbackTrust({ env, desktopManaged: false, hostedWorkspace: hostedWorkspaceConfigured(env) }).trust === "service";
  const ownerToken = serviceTrust ? randomBytes(32).toString("base64url") : undefined;
  if (ownerToken) env.ALCA_CLI_OWNER_STDIN = "1";
  else delete env.ALCA_CLI_OWNER_STDIN;
  if (entry.staticDir) env.ALCA_STATIC_DIR = entry.staticDir;
  if (entry.skillsDir && !process.env.ALCA_SKILLS_DIR) env.ALCA_SKILLS_DIR = entry.skillsDir;
  if (options.label && !process.env.ALCA_ENVIRONMENT_LABEL) env.ALCA_ENVIRONMENT_LABEL = options.label;
  let logPath: string | undefined;
  let logFd: number | undefined;
  let tailscaleServing = false;
  let tailscaleAttempted = false;
  let startupCancelled = false;
  const cancelStartup = () => { startupCancelled = true; };
  process.on("SIGINT", cancelStartup);
  process.on("SIGTERM", cancelStartup);
  let child: ChildProcess;
  try {
    if (options.guided) {
      const logsDir = join(options.dataDir, "logs");
      mkdirSync(logsDir, { recursive: true, mode: 0o700 });
      logPath = join(logsDir, `server-${Date.now()}-${process.pid}.log`);
      logFd = openSync(logPath, "wx", 0o600);
      log("\nStarting your workspace…");
    }
    if (tailscale) {
      tailscaleAttempted = true;
      const served = await tailscaleServe(tailscale, options.port);
      if (startupCancelled) throw new SetupCancelled();
      if ("failure" in served) throw new Error(`--tailscale: ${explainTailscaleFailure(served.failure)}`);
      tailscaleServing = true;
      publicUrl = served.origin;
      log(`tailscale: serving https://${tailscale.dnsName} → http://127.0.0.1:${options.port} (only your tailnet can reach it)`);
    }
    if (startupCancelled) throw new SetupCancelled();
    if (publicUrl) env.ALCA_PUBLIC_URL = publicUrl;
    child = spawn(entry.command, entry.args, { env, stdio: [ownerToken ? "pipe" : "ignore", logFd ?? "inherit", logFd ?? "inherit"] });
    if (ownerToken) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(`${ownerToken}\n`);
      serveOwnerToken = ownerToken;
    }
  } catch (error) {
    if ((tailscaleServing || (startupCancelled && tailscaleAttempted)) && tailscale) await tailscaleServeOff(tailscale).catch(() => undefined);
    if (error instanceof SetupCancelled) {
      log("Startup cancelled. No server was started; your saved work is unchanged.");
      return 130;
    }
    throw error;
  } finally {
    if (logFd !== undefined) closeSync(logFd);
    process.removeListener("SIGINT", cancelStartup);
    process.removeListener("SIGTERM", cancelStartup);
  }
  let exited: number | null = null;
  const childExit = new Promise<number>((done) => {
    child.once("error", () => { exited = 1; done(1); });
    child.once("exit", (code, signal) => { exited = code ?? (signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1); done(exited); });
  });
  let caddy: RunningCaddy | null = null;
  let stopping: Promise<void> | null = null;
  const stop = () => {
    stopping ??= (async () => {
      // The edge stops accepting before the server it forwards to goes away.
      if (caddy) await caddy.stop().catch(() => undefined);
      if (tailscaleServing && tailscale) await tailscaleServeOff(tailscale).catch(() => undefined);
      if (exited === null) {
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
        timer.unref();
        await childExit;
        clearTimeout(timer);
      }
    })();
    return stopping;
  };
  const onSignal = () => { void stop(); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && exited === null && !stopping) {
      if (await serverUp(options.port, child.pid)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (exited !== null) {
      if (exited !== 0) log(`AlcaBots could not start.${logPath ? ` Details: ${logPath}` : " See the output above."}`);
      return exited;
    }
    if (stopping) return await childExit;
    if (!(await serverUp(options.port, child.pid))) {
      console.error(`AlcaBots did not become ready within a minute.${logPath ? ` Details: ${logPath}` : " See its output above."}`);
      await stop();
      return 1;
    }
    if (stopping || exited !== null) return await childExit;
    if (options.domain && caddyBinary) {
      try {
        caddy = await startCaddy({ binary: caddyBinary, dataDir: options.dataDir, domain: options.domain, appPort: options.port, webhookPort: Number(env.ALCA_WEBHOOK_PORT), log });
        log(`https: Caddy serves ${publicUrl} → http://127.0.0.1:${options.port}; it gets the certificate from Let's Encrypt once DNS for ${options.domain} points at this machine`);
        void caddy.exited.then((code) => {
          if (!stopping) log(`caddy: stopped (exit ${code ?? "signal"}); ${publicUrl} is no longer served. Stop and start the server again.`);
        });
      } catch (error) {
        console.error(`--domain: ${message(error)}`);
        await stop();
        return 1;
      }
    }
    log("");
    log(`AlcaBots is running on http://127.0.0.1:${options.port}${publicUrl ? `, reachable at ${publicUrl}` : ""}`);
    if (options.guided) {
      log("Your bots and conversations are saved automatically.");
      log(`Details if you need help: ${logPath}`);
      if (options.open !== false && !await openDashboard(options.port)) log("Open the local address above in a browser on this computer.");
    } else {
      log(`data: ${options.dataDir}`);
      const ego = egoBrowserStatus();
      log(ego.kind === "ready" ? `browser: ego lite (${ego.path})` : `browser: unavailable. ${ego.reason}`);
    }
    if (options.pair) {
      log("");
      try {
        log(await mintPairing(options.port, { label: options.label ? `${options.label} owner` : undefined, client: options.client, publicUrl: publicUrl ?? undefined, guided: options.guided }));
        if (!options.guided) log("\nanother device later:  alcabots pair --label \"Kitchen iPad\"");
      } catch (error) {
        log(`no pairing code: ${message(error)}`);
        log("start without one next time:  alcabots serve --no-pair");
      }
    }
    log(options.guided ? "\nKeep this terminal open while using your bots. Ctrl+C stops the server, not your saved work." : "stop with Ctrl+C");
    if (options.guided) log("Next time: alcabots · Change AI setup: alcabots setup · Use from your phone: alcabots phone");
    return await childExit;
  } finally {
    serveOwnerToken = undefined;
    await stop();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

/** A server exiting with RESTART_EXIT_CODE is started again here at the same address, without a second pairing code. */
export async function serveUntilStopped(options: CliOptions, run: (options: CliOptions) => Promise<number> = runServe, now: () => number = Date.now): Promise<number> {
  const policy = restartPolicy(now);
  let launch = options;
  for (;;) {
    const code = await run(launch);
    if (!policy.again(code)) return code;
    console.log("\nAlcaBots is starting again to finish installing a copy from the desktop app…");
    launch = { ...options, pair: false, open: false };
  }
}

/** Setup imports stay behind the data-dir override: config binds its paths when first imported. */
export async function runOnboardingCommand(
  options: CliOptions,
  io: CliIo = defaultIo(),
  startServer: (options: CliOptions) => Promise<number> = serveUntilStopped,
  flow: { prompts?: SetupIo; running?: typeof isWorkspaceRunning; open?: typeof openDashboard } = {},
): Promise<number> {
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (options.command === "setup" && !interactive) {
    io.error("Setup needs an interactive terminal. Run `npx alcabots setup` in a terminal, then use `npx alcabots serve` for unattended starts.");
    return 1;
  }
  process.env.ALCA_DATA_DIR = options.dataDir;
  if (options.command !== "setup" && await (flow.running ?? isWorkspaceRunning)(options)) {
    if (options.local || options.tailscale || options.publicUrl) {
      io.error("This workspace is already running. Stop it before changing local or remote access; the current connection was not changed.");
      return 1;
    }
    io.log(`Your workspace is already running: http://127.0.0.1:${options.port}`);
    io.log("No second server was started. Your existing bots and conversations are unchanged.");
    if (interactive && options.open !== false) await (flow.open ?? openDashboard)(options.port);
    return 0;
  }
  const { runSetup, isSetupComplete, readCliStartup } = await import("./cli-setup.ts");
  try {
    if (options.command === "setup" || !(await isSetupComplete(options.dataDir))) {
      if (!interactive) {
        io.error("No completed setup was found. Run `npx alcabots setup` in an interactive terminal first, or use `npx alcabots serve` with an existing configuration.");
        return 1;
      }
      if (!(await runSetup({ dataDir: options.dataDir, port: options.port }))) {
        io.log("Setup cancelled. Run alcabots when you're ready.");
        return 130;
      }
    }
    const saved = readCliStartup(options.dataDir);
    // Only setup revisits the access choice; normal starts reuse consent and never turn a local session public.
    const launch = options.command === "setup" ? options : applyStartupPreferences(options, saved);
    if (options.command === "setup") {
      io.log("\nAll set. Start with: alcabots (or npx alcabots without a global install). To use it from your phone: alcabots phone");
      if (options.dataDir !== join(homedir(), ".alcabots") || options.port !== 8799) {
        io.log(`Use the same --data-dir (${options.dataDir}) and --port (${options.port}) options when starting.`);
      }
      return 0;
    }
    if (saved) io.log("\nWelcome back. Using your saved AI connection.");
    return startServer({ ...launch, guided: interactive });
  } catch (error) {
    if (!(error instanceof SetupCancelled)) throw error;
    io.log("\nSetup stopped. Any AI setup already saved is kept; no server was started. Run alcabots setup to continue.");
    return 130;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv[0] === "sentinel") return runSentinelCli(argv.slice(1));
  if (HEADLESS_VERB_NAMES.has(argv[0] ?? "") || (argv[0] === "help" && HEADLESS_VERB_NAMES.has(argv[1] ?? ""))) return (await import("./headless/main.ts")).runHeadless(argv);
  const options = parseArgs(argv);
  if ("error" in options) {
    console.error(`${options.error}\n\n${USAGE}`);
    return 2;
  }
  process.env.ALCA_DATA_DIR = options.dataDir;
  switch (options.command) {
    case "setup":
    case "start":
      return runOnboardingCommand(options);
    case "serve":
      return serveUntilStopped(options);
    case "pair":
      return runPair(options);
    case "sessions":
      return runSessions(options);
    case "status":
      return runStatus(options);
    case "phone":
      return runPhonePairing(options.port, { daily: options.client });
    case "access":
      return runAccess(options);
    case "service":
      return runServiceCommand({
        action: options.serviceAction ?? "install", dataDir: options.dataDir, port: options.port, domain: options.domain,
        tailscale: options.tailscale, label: options.label, sentinel: options.sentinel, script: process.argv[1] ?? "", node: process.execPath,
      }, { log: (line) => console.log(line), error: (line) => console.error(line) });
    case "fleet":
      if (options.fleetAction === "agent") {
        const layout = fleetLayout();
        await startFleetAgent({
          socketPath: options.socket ?? layout.socketPath,
          group: options.group,
          node: process.execPath,
          script: process.argv[1] ?? "",
          licenseKey: options.licenseKey ?? process.env.ALCA_LICENSE_KEY,
        }, { log: (line) => console.log(line) });
        await new Promise<void>((resolveStop) => {
          for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => resolveStop());
        });
        return 0;
      }
      return runFleetCommand({
        action: options.fleetAction as FleetInput["action"],
        slug: options.slug,
        domain: options.domain,
        operator: options.operator ?? process.env.SUDO_USER,
        admins: options.admins ?? [],
        members: options.members ?? [],
        brandFile: options.brandFile,
        anthropicKeyFile: options.anthropicKeyFile,
        cap: options.cap,
        licenseKey: options.licenseKey ?? process.env.ALCA_LICENSE_KEY,
        memory: options.memory,
        dryRun: options.dryRun ?? false,
        yes: options.yes ?? false,
        keepData: options.keepData ?? false,
        userAction: options.fleetUserAction,
        email: options.email,
        chatOnly: options.chatOnly,
        node: process.execPath,
        script: process.argv[1] ?? "",
      }, { log: (line) => console.log(line), error: (line) => console.error(line) });
    case "browser":
      return runBrowser(options);
    default:
      console.log(USAGE);
      return 0;
  }
}
