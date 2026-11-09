// End to end in a real browser, against an isolated data folder and a fake engine: a phone-sized page pairs through a
// local relay and has a conversation with a real server.
//
//   pnpm build:phone && PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/smoke-phone-link.mjs [--direct]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPLY = "hello from fake claude";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const direct = process.argv.includes("--direct");
const shots = process.env.SMOKE_SHOTS ?? tmpdir();
/** The deployed relay and site, instead of ones started here: `SMOKE_LIVE_RELAY=https://… SMOKE_LIVE_SITE=https://…`. */
const liveRelay = process.env.SMOKE_LIVE_RELAY;
const liveSite = process.env.SMOKE_LIVE_SITE;
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core");

const freePort = () => new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, label, ms = 30_000) {
  const start = Date.now();
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`timed out: ${label}\n${logs.join("").slice(-3000)}`);
    await sleep(100);
  }
}

const logs = [];
const children = [];
const run = (args, env) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  children.push(child);
  return child;
};

const home = mkdtempSync(join(tmpdir(), "alca-phone-smoke-"));
const dataDir = join(home, ".alcabots");
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "config.json"), JSON.stringify({
  instances: { claude: { driver: "claudeAgent", displayName: "Fixture", config: { cli: join(root, "server", "testing", "fake-claude-cli.ts") } } },
}));

let browser;
let failed = false;
try {
  const relayPort = await freePort();
  const port = await freePort();
  const relayUrl = liveRelay ?? `http://127.0.0.1:${relayPort}`;
  if (!liveRelay) run(["--experimental-strip-types", "link/relay/main.ts", "--port", String(relayPort), "--site", join(root, "dist-phone")], { PATH: process.env.PATH });
  run(["server/index.ts"], {
    PATH: process.env.PATH, HOME: home, USERPROFILE: home, ALCA_DATA_DIR: dataDir, ALCA_PORT: String(port), ALCA_WEBHOOK_PORT: String(port + 1000),
    FAKE_CLAUDE_MODE: "happy", ALCA_LINK_RELAY_URL: relayUrl, ALCA_LINK_SITE_URL: liveSite ?? relayUrl, ALCA_LINK_ALLOW_LOOPBACK: "1",
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
    return JSON.parse(text);
  };
  await until(async () => (await fetch(`${base}/api/health`)).ok, "server start");
  await api("PATCH", "/api/link", { enabled: true, iceServers: direct ? ["stun:127.0.0.1:9"] : [] });
  await until(async () => (await api("GET", "/api/link")).status === "online", "computer on the relay");
  await api("POST", "/api/bots", { name: "Ledger", modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
  await api("PUT", "/api/config", { onboarding: { completedAt: new Date().toISOString(), version: 99 } });
  const pairing = await api("POST", "/api/link/pairings", { access: "full" });

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => { if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`); });
  page.on("console", (message) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  await page.goto(pairing.url);
  await page.locator("button[type=submit]").click();
  if (new URL(page.url()).hash) throw new Error("the pairing code stayed in the address");
  await until(async () => (await api("GET", "/api/link")).devices[0]?.connection, "phone connected");
  if (direct) await until(async () => (await api("GET", "/api/link")).devices[0]?.connection === "rtc", "direct path", 30_000);
  await page.getByText("Ledger").first().waitFor({ timeout: 60_000 });
  await page.screenshot({ path: join(shots, "phone-home.png") });
  await page.getByText("Ledger").first().click();
  const box = page.locator("textarea, [contenteditable=true]").first();
  await box.waitFor({ timeout: 30_000 });
  await box.fill("hello from the phone");
  await box.press("Enter");
  await until(async () => (await page.locator("body").innerText()).includes(REPLY), "reply on the phone", 45_000)
    .catch(async (error) => {
      await page.screenshot({ path: join(shots, "phone-chat.png") });
      throw error;
    });
  await sleep(1500);
  await page.screenshot({ path: join(shots, "phone-chat.png") });
  const via = (await api("GET", "/api/link")).devices[0];
  // XMLHttpRequest isn't moved onto the connection by the page, so it stands for an <img> or a <video>.
  await until(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), "service worker in control");
  const media = await page.evaluate(() => new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("GET", "/api/bots");
    request.onload = () => resolve({ status: request.status, bots: request.responseText.includes("Ledger") });
    request.onerror = () => resolve({ status: 0 });
    request.send();
  }));
  if (media.status !== 200 || !media.bots) throw new Error(`media through the service worker: ${JSON.stringify(media)}`);
  await context.setOffline(true);
  await page.reload();
  await page.getByText("Ledger").first().waitFor({ timeout: 15_000 });
  await page.screenshot({ path: join(shots, "phone-offline.png") });
  await context.setOffline(false);
  await until(async () => (await api("GET", "/api/link")).devices[0]?.connection, "phone reconnected", 45_000);
  await context.grantPermissions(["notifications"]);
  const cdp = await context.newCDPSession(page);
  const registrationId = await new Promise((resolve) => {
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => { if (registrations[0]) resolve(registrations[0].registrationId); });
    void cdp.send("ServiceWorker.enable");
  });
  await cdp.send("ServiceWorker.deliverPushMessage", {
    origin: new URL(page.url()).origin,
    registrationId,
    data: JSON.stringify({ title: "Ledger", body: "Needs you", tag: "approval:t", botId: "b", threadId: "t" }),
  });
  await sleep(2500);
  await until(() => page.evaluate(async () => {
    const shown = await (await navigator.serviceWorker.ready).getNotifications();
    return shown.some((note) => note.title === "Ledger" && note.body === "Needs you" && note.data?.threadId === "t");
  }), "the push on screen");
  const { bots } = await api("GET", "/api/bots?messages=0");
  const ledger = bots.find((bot) => bot.name === "Ledger");
  const tapNotification = (botId, threadId) => context.serviceWorkers()[0].evaluate(async (data) => {
    const note = (await self.registration.showNotification("Ledger", { body: "Needs you", tag: "tap", data }), (await self.registration.getNotifications({ tag: "tap" }))[0]);
    let done;
    const work = new Promise((resolve) => { done = resolve; });
    const event = new NotificationEvent("notificationclick", { notification: note });
    const waitUntil = event.waitUntil.bind(event);
    event.waitUntil = (promise) => { waitUntil(promise); void promise.then(done, done); };
    self.dispatchEvent(event);
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }, { botId, threadId });
  await tapNotification(ledger.id, ledger.threadId);
  await page.locator("[data-phone-chat] textarea, [data-phone-chat] [contenteditable=true]").first().waitFor({ timeout: 30_000 });
  await page.locator(".phone-back").click();
  await page.locator("[data-phone-chat]").waitFor({ state: "detached", timeout: 10_000 });
  const site = new URL(page.url()).origin;
  await page.goto("about:blank");
  await tapNotification(ledger.id, ledger.threadId).catch(() => {});
  await page.goto(site);
  await page.locator("[data-phone-chat] textarea, [data-phone-chat] [contenteditable=true]").first().waitFor({ timeout: 30_000 });
    console.log(JSON.stringify({ ok: true, device: via, problems: problems.slice(0, 12) }, null, 2));
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
  await sleep(500);
  rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
