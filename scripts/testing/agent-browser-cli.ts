// The developer's own agent-browser, which the UI checks drive the app with. AlcaBots no longer ships or downloads it.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { findCliCandidates } from "../../server/env-path.ts";

export function resolveAgentBrowserBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.ALCA_AGENT_BROWSER_PATH?.trim();
  if (override) return existsSync(resolve(override)) ? resolve(override) : null;
  return findCliCandidates("agent-browser")[0] ?? null;
}

function run(binary: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const record = (chunk: Buffer) => { output = (output + String(chunk)).slice(-262_144); };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    const timer = setTimeout(() => { child.kill("SIGKILL"); done({ ok: false, output: `${output}\ntimed out` }); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); done({ ok: false, output: String(error) }); });
    child.on("close", (code) => { clearTimeout(timer); done({ ok: code === 0, output }); });
  });
}

/** `agent-browser install`: downloads Chrome for Testing when no Chrome is found. */
export async function ensureChrome(binary: string, options: { env?: NodeJS.ProcessEnv; log?: (line: string) => void } = {}): Promise<void> {
  const result = await run(binary, ["install"], options.env ?? process.env, 10 * 60_000);
  if (!result.ok) throw new Error(`agent-browser install failed: ${result.output.trim().split("\n").slice(-3).join(" ")}`);
  options.log?.("agent-browser: Chrome is ready");
}

export async function closeBrowserSession(binary: string, env: NodeJS.ProcessEnv, timeoutMs = 15_000): Promise<boolean> {
  return (await run(binary, ["close"], env, timeoutMs)).ok;
}
