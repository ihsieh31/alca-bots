# The bots' browser: ego lite

**Decision (Nov 8, 2026):** bots browse through ego lite, the Chromium browser
the person installs on their own macOS or Windows computer, driven with its
`ego-browser` CLI. It replaces the built-in browser (the agent-browser engine
and AlcaBots's own `alca-cdp` Chrome driver), together with everything that
existed only for it: the live view and takeover panel, browser profiles, the
signed-in sites list, `fill_login` and saved logins, recorded browser steps,
My Chrome and the Chrome a computer lends to My Cloud, and the headless
browser on servers and in Docker.

## Why

- ego lite is a browser people and agents share: the person sees every page
  the bot opens, in their own window, and takes over there. AlcaBots no
  longer needs its own frame stream, input relay and control gate.
- The bot uses the person's real, signed-in browser, which sites trust more
  than a headless Chrome (`navigator.webdriver` false).
- One small integration instead of some 40,000 lines of engine, live view,
  process hygiene and evidence code.

## Shape

```
bot turn → MCP server "browser" (server/ego-browser-proxy.ts) → ego-browser nodejs → ego lite
```

- `server/ego-browser.ts` finds the CLI: `ALCA_EGO_BROWSER_PATH`, else the
  app's augmented PATH (ego lite's onboarding installs it in `~/.local/bin`
  on macOS). `egoBrowserIntegration()` returns the MCP spec a turn mounts as
  `browser`, the same slot every driver already mounts (Claude, Codex, pi,
  ACP, OpenAI-compatible chat). Turns mount it when the workspace's Browser
  setting, the bot's browser switch and the provider's `browserMcp`
  capability allow, and the CLI is found.
- The proxy offers two tools:
  - `ego_browser_guide` runs `ego-browser skill` and returns the usage guide
    for the installed ego lite version (cached per proxy once complete).
  - `ego_browser_run {script, timeoutMs?}` pipes the script to
    `ego-browser nodejs` and returns its output (60,000 characters at most,
    head and tail kept). Images the script wrote during the call and printed
    by absolute path (`.png`, `.jpg`, `.webp`; three, 5 MB each at most) are
    attached, so `page.screenshot()` reaches the model. A non-zero exit or a
    timeout (default 120 s, at most 600 s) is an error result.
- `EGO_BROWSER_SYSTEM_PROMPT` tells the bot to read the guide first, keep one
  TaskSpace per goal, hand the browser over with `task.handOff()` for
  sign-ins and human checks, and close it with `task.finish({ keep: [] })`.
- `ego_browser_*` tools count as browser tools for the screen surface
  (`shared/tool-surface.ts`) and usage traces.
- `alcabots browser status` and `alcabots browser install` report whether
  the CLI is found and how to install ego lite.

## Known risk

`ego-browser nodejs` runs the bot's script in ego lite's embedded Node.js
runtime, outside AlcaBots's bot box and engine permission settings, with the
person's files and network. The `browser` MCP server is pre-approved for
Claude, as the built-in browser was. A bot with the browser on can therefore
read and write files it otherwise could not. The bot's browser switch is the
gate.

## Not supported

- Linux, servers, Docker, AlcaBot Cloud and Team Cloud: ego lite runs only on
  macOS and Windows desktops, so those hosts have no browser.
- Typing saved logins, listing signed-in sites, recording browser steps.
