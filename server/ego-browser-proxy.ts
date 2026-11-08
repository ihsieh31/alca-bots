// ego lite (ego-browser CLI) as MCP tools over stdio JSON-RPC 2.0: ego_browser_guide and ego_browser_run.
//
// Known open risk: `ego-browser nodejs` runs the bot's script in ego lite's embedded Node.js runtime, outside any
// AlcaBots sandbox, with the person's file system and network. Mounting this server gives a bot that much reach.
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import readline from "node:readline";

const COMMAND = process.env.ALCA_EGO_BROWSER_COMMAND ?? "ego-browser";
const PREFIX: string[] = (() => {
  try {
    const parsed: unknown = JSON.parse(process.env.ALCA_EGO_BROWSER_ARGS ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((arg): arg is string => typeof arg === "string") : [];
  } catch {
    return [];
  }
})();

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 60_000;
const MAX_SCRIPT_CHARS = 200_000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const GUIDE_END = "[ego-browser:skill] end of guide";

const TOOLS = [
  {
    name: "ego_browser_guide",
    description:
      "Print the usage guide for the installed ego lite browser: its TaskSpace, Page, mouse and keyboard APIs and the rules for using them. Call it once before your first ego_browser_run in a conversation, and again after a result says ego lite was upgraded.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ego_browser_run",
    description:
      "Run one Node.js script with `ego-browser nodejs` to drive the ego lite browser, as the guide from ego_browser_guide describes (taskSpace(), task.page(\"p1\"), page.goto(), page.snapshot(), page.click()…). Returns what the script printed. Screenshot files the script saves and prints by absolute path are attached as images.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "The script. Use absolute paths for files; it does not see your working folder or environment variables." },
        timeoutMs: { type: "number", description: `Stop the script after this many milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}, at most ${MAX_TIMEOUT_MS}.` },
      },
      required: ["script"],
    },
  },
];

type Json = Record<string, unknown>;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

interface RunResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

function runEgo(args: string[], input: string | null, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(COMMAND, [...PREFIX, ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT_CHARS * 4) output += chunk.toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "");
  });
}

function clip(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n… [${text.length - max} characters cut] …\n${text.slice(-half)}`;
}

const IMAGE_PATH = /(?:[A-Za-z]:\\|\/)[^\s"'`<>|]*?\.(png|jpe?g|webp)\b/giu;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Images the script wrote during this run and printed by absolute path. */
async function printedImages(output: string, since: number): Promise<Content[]> {
  const seen = new Set<string>();
  const images: Content[] = [];
  for (const match of output.matchAll(IMAGE_PATH)) {
    const path = match[0];
    if (seen.has(path) || !isAbsolute(path) || images.length >= MAX_IMAGES) continue;
    seen.add(path);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > MAX_IMAGE_BYTES || info.mtimeMs < since) continue;
    const ext = (match[1] ?? "png").toLowerCase();
    images.push({ type: "image", data: (await readFile(path)).toString("base64"), mimeType: MIME[ext] ?? "image/png" });
  }
  return images;
}

let guide: string | null = null;

async function callTool(name: string, args: Json): Promise<{ content: Content[]; isError?: boolean }> {
  if (name === "ego_browser_guide") {
    const result = guide === null ? await runEgo(["skill"], null, 30_000) : null;
    if (result) {
      if (result.code !== 0) return { content: [{ type: "text", text: notRunning(result) }], isError: true };
      if (result.output.includes(GUIDE_END)) guide = result.output;
      else return { content: [{ type: "text", text: result.output }] };
    }
    return { content: [{ type: "text", text: guide ?? "" }] };
  }
  if (name === "ego_browser_run") {
    const script = args.script;
    if (typeof script !== "string" || !script.trim()) return { content: [{ type: "text", text: "ego_browser_run needs a script." }], isError: true };
    if (script.length > MAX_SCRIPT_CHARS) return { content: [{ type: "text", text: `The script is longer than ${MAX_SCRIPT_CHARS} characters.` }], isError: true };
    const requested = typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) ? args.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(Math.max(Math.round(requested), 1_000), MAX_TIMEOUT_MS);
    const started = Date.now() - 1_000;
    const result = await runEgo(["nodejs"], script, timeoutMs);
    if (result.code === null && !result.timedOut) return { content: [{ type: "text", text: notRunning(result) }], isError: true };
    const text = clip(result.output.trim() || "(the script printed nothing)")
      + (result.timedOut ? `\n[stopped after ${timeoutMs} ms; the browser may still be acting. Observe the page before retrying.]` : "")
      + (result.code !== 0 && !result.timedOut ? `\n[ego-browser exited with code ${String(result.code)}]` : "");
    return { content: [{ type: "text", text }, ...(await printedImages(result.output, started))], isError: result.timedOut || result.code !== 0 };
  }
  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
}

function notRunning(result: RunResult): string {
  return `ego-browser could not run (${clip(result.output.trim(), 2_000) || "no output"}). Ask the person to open ego lite and finish its onboarding.`;
}

const send = (msg: Json) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg: Json) {
  const id = msg.id;
  const method = msg.method as string | undefined;
  if (!method) return;
  const params = (msg.params ?? {}) as Json;
  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: (params.protocolVersion as string) ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "ego-browser-proxy", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      ok(id, {});
      return;
    case "tools/list":
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = params.name as string;
      if (!TOOLS.some((tool) => tool.name === name)) return rpcErr(id, -32602, `Unknown tool: ${name}`);
      const rawArgs = params.arguments;
      const args = typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs) ? (rawArgs as Json) : {};
      try {
        ok(id, await callTool(name, args));
      } catch (error) {
        ok(id, { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
      return;
    }
    default:
      if (id !== undefined) rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: Json;
  try {
    msg = JSON.parse(trimmed) as Json;
  } catch {
    return;
  }
  void handle(msg).catch((error: unknown) => {
    if (msg.id !== undefined) rpcErr(msg.id, -32603, error instanceof Error ? error.message : String(error));
  });
});
rl.on("close", () => process.exit(0));
