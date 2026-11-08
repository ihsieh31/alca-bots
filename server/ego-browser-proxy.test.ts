import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, describe, expect, it } from "vitest";

import { egoBrowserCommand, egoBrowserIntegration } from "./ego-browser.ts";
import { botSpaces, setEgoHold } from "./ego-state.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

const dir = mkdtempSync(join(tmpdir(), "ego-proxy-"));
const png = join(dir, "shot.png");
const fake = join(dir, "ego-browser");
writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "skill") { console.log("guide body\\n[ego-browser:skill] end of guide v9"); process.exit(0); }
if (args[0] !== "nodejs") process.exit(2);
let script = "";
process.stdin.on("data", (c) => { script += c; });
process.stdin.on("end", () => {
  const made = ${JSON.stringify(join(dir, "made"))};
  if (script.includes("listTaskSpaces")) { console.log(JSON.stringify(require("node:fs").existsSync(made) ? [1, 2] : [1])); return; }
  if (script.includes("NEWSPACE")) { require("node:fs").writeFileSync(made, ""); console.log("spaceId: 1"); return; }
  if (script.includes("FAIL")) { console.error("EGO_PAGE_UNRESPONSIVE"); process.exit(1); }
  if (script.includes("HANG")) { setInterval(() => {}, 1000); return; }
  if (script.includes("SHOT")) { require("node:fs").writeFileSync(${JSON.stringify(png)}, Buffer.from([137, 80, 78, 71])); console.log("saved " + ${JSON.stringify(png)}); return; }
  console.log("ran: " + script);
});
`);
chmodSync(fake, 0o755);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function session(calls: Array<{ name: string; arguments?: Record<string, unknown> }>, extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, [SPAWNED_PROXIES.egoBrowser], {
    env: { ...process.env, ALCA_EGO_BROWSER_COMMAND: process.execPath, ALCA_EGO_BROWSER_ARGS: JSON.stringify([fake]), ...extraEnv },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout });
  const replies = new Map<number, (value: unknown) => void>();
  lines.on("line", (line) => {
    const msg = JSON.parse(line) as { id: number; result: unknown };
    replies.get(msg.id)?.(msg.result);
  });
  const request = (id: number, method: string, params: unknown) => new Promise<unknown>((resolve) => {
    replies.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const tools = await request(1, "tools/list", {});
  const results = [];
  for (const [index, call] of calls.entries()) results.push(await request(index + 2, "tools/call", call));
  child.stdin.end();
  return { tools, results: results as Array<{ isError?: boolean; content: Array<{ type: string; text?: string; mimeType?: string }> }> };
}

describe("ego-browser proxy", () => {
  it("records the spaces a bot's script made or named, and refuses while the person holds the browser", async () => {
    const state = join(dir, "state");
    const env = { ALCA_EGO_BOT_ID: "bot-1", ALCA_EGO_STATE_DIR: state };
    await session([{ name: "ego_browser_run", arguments: { script: "NEWSPACE" } }], env);
    expect(botSpaces(state, "bot-1")).toEqual([2, 1]);
    setEgoHold(state, "bot-1", { by: "phone", until: Date.now() + 60_000 });
    const { results } = await session([{ name: "ego_browser_run", arguments: { script: "anything" } }], env);
    expect(results[0]).toMatchObject({ isError: true });
    expect(results[0]!.content[0]!.text).toMatch(/controlling ego lite from their phone/);
  });

  it("lists the guide and run tools", async () => {
    const { tools } = await session([]);
    expect((tools as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual(["ego_browser_guide", "ego_browser_run"]);
  });

  it("prints the guide and runs scripts through stdin", async () => {
    const { results } = await session([
      { name: "ego_browser_guide" },
      { name: "ego_browser_run", arguments: { script: "const task = await taskSpace('x');" } },
    ]);
    expect(results[0]?.content[0]?.text).toContain("end of guide");
    expect(results[1]?.isError).toBe(false);
    expect(results[1]?.content[0]?.text).toBe("ran: const task = await taskSpace('x');");
  });

  it("reports a failing script, a timeout and a missing script as errors", async () => {
    const { results } = await session([
      { name: "ego_browser_run", arguments: { script: "FAIL" } },
      { name: "ego_browser_run", arguments: { script: "HANG", timeoutMs: 1_000 } },
      { name: "ego_browser_run", arguments: {} },
    ]);
    expect(results[0]).toMatchObject({ isError: true });
    expect(results[0]?.content[0]?.text).toContain("EGO_PAGE_UNRESPONSIVE");
    expect(results[1]?.content[0]?.text).toContain("stopped after 1000 ms");
    expect(results[1]?.isError).toBe(true);
    expect(results[2]?.isError).toBe(true);
  });

  it("attaches a screenshot the script saved and printed", async () => {
    const { results } = await session([{ name: "ego_browser_run", arguments: { script: "SHOT" } }]);
    expect(results[0]?.content.map((part) => part.type)).toEqual(["text", "image"]);
    expect(results[0]?.content[1]?.mimeType).toBe("image/png");
  });
});

describe("ego-browser integration", () => {
  it("mounts the proxy with the CLI named by ALCA_EGO_BROWSER_PATH", () => {
    const env = { ...process.env, ALCA_EGO_BROWSER_PATH: fake };
    const ego = egoBrowserCommand(env);
    // Windows runs a script file through Node rather than by its shebang.
    expect([ego?.command, ...(ego?.args ?? [])]).toContain(fake);
    const spec = egoBrowserIntegration(env);
    expect(spec?.args).toEqual([SPAWNED_PROXIES.egoBrowser]);
    expect(spec?.env.ALCA_EGO_BROWSER_COMMAND).toBe(ego?.command);
  });
});
