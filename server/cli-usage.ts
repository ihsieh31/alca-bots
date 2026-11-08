export { HEADLESS_VERBS as HEADLESS_VERB_NAMES } from "./headless/args.ts";

export const HEADLESS_USAGE = `Drive a running workspace (scripts, CI, other agents):
  alcabots doctor                    check the server answers and an engine is ready
  alcabots doctor --host             check this Linux machine can run a server (exit 7 if not)
  alcabots bots | channels | models  your bots, your rooms, the engines and their models
  alcabots run BOT "do this"         give a bot one job and wait until it and every teammate it asked are done
  alcabots send BOT "text"           send one message and return at once
  alcabots wait BOT                  wait on work already running
  alcabots messages BOT              the latest messages of a conversation
  alcabots interrupt BOT [--tree]    press Stop (--tree: and every teammate on its job)
  alcabots export BOT --out DIR      write a job's transcripts, files and screens to DIR
  alcabots events [--job THREAD]     the server's live events as JSON lines
  alcabots team apply FILE           make the workspace match a team file (team export writes one)
  alcabots engine set claude --key-env ANTHROPIC_API_KEY   give it an engine without a screen
  alcabots connect URL --code CODE --out FILE              get a token for a workspace elsewhere
  alcabots token create NAME --out FILE [--expires 90d]    a token for CI that ends on its date (token list, token revoke ID)
  alcabots new-bot | new-channel | set-model | edit | mcp

  Server: --url URL (or ALCABOTS_URL), --port N (or ALCA_PORT), else this computer's.
  Token: ALCABOTS_TOKEN or --token-file FILE. --json prints one JSON document;
  progress goes to stderr (--quiet drops it). alcabots help VERB for the details.`;

export const USAGE = `alcabots — your team of AI bots, ready in a few steps

  alcabots                         set up once, then open your workspace
  alcabots setup [--data-dir DIR]
  alcabots start [the same options as serve]
  alcabots serve [--port 8799] [--data-dir DIR] [--label NAME]
                    [--public-url https://host] [--tailscale | --domain HOST] [--no-pair]
  alcabots pair  [--label NAME] [--client] [--ttl 24h]
                    [--public-url https://host]
  alcabots sessions [revoke ID]
  alcabots status
  alcabots phone [--daily]
  alcabots access list | add EMAIL [--chat-only] | remove EMAIL
  alcabots service install [--domain HOST | --tailscale] [--port N] [--data-dir DIR] | uninstall
                    [--sentinel]   (the health scan below, every two minutes, instead of the server)
  alcabots sentinel [--data-dir DIR] [--out DIR] [--once] [--json]   (read-only health scan; see --help)
  alcabots browser install | status
  alcabots fleet init --domain HOST [--operator USER] | create NAME --admin EMAIL [--member EMAIL] [--brand FILE]
                    [--anthropic-key-file FILE] [--cap USD] [--license-key KEY] [--memory 1G]
                  | list | users NAME add|remove EMAIL [--chat-only] | suspend NAME | resume NAME
                  | delete NAME --yes [--keep-data] | upgrade   (all take --dry-run)
                  | agent [--socket PATH] [--group USER]   (root; installed by init --operator)

setup   choose AI access; keep existing bots and chats
start   same as alcabots: use your saved settings and open the workspace
serve   starts the server without prompts and prints a pairing link + QR code
pair    mints a pairing code against a running server (--client: chat only;
        --ttl keeps it open up to 24h, still single use)
sessions lists paired devices; "sessions revoke ID" signs one out
status  what the server says about itself
phone   turns phone access on and shows a code for your phone's browser;
        --daily leaves out settings and permissions
access  who may sign in with an emailed code at /pair: an address or
        @domain; --chat-only gives chat and approvals without settings.
        Takes effect at once, no restart.
service keep the server running across reboots: writes a systemd unit
        (Linux) or a launchd agent (macOS) for the same serve options and
        prints the commands that install it. Install the package
        permanently first (npm install -g alcabots).
browser status: whether the bots' browser, ego lite, is installed (the
        ego-browser command on PATH, or ALCA_EGO_BROWSER_PATH).
        install: how to install ego lite (macOS and Windows only).
fleet   many client workspaces on one Linux server, each its own account,
        service, data folder, brand, sign-in list and keys at NAME.HOST
        behind the system Caddy. Plans are printed unless run as root;
        --dry-run always prints. Install the package permanently first.
        init --operator USER also installs the fleet agent, a root service
        on a Unix socket only USER may open, so the workspace running as
        USER manages the others from Settings → Installations.

--tailscale  serve over your tailnet: Tailscale terminates HTTPS and the
             link uses this machine's MagicDNS name (needs Tailscale signed in
             and HTTPS certificates enabled for the tailnet)
--domain     serve at https://HOST on your own domain: a pinned Caddy is
             downloaded once and run alongside the server, and gets the
             certificate itself. Point the domain's DNS at this machine and
             open ports 80 and 443.

--no-open   do not open a browser window
--no-pair   do not print a pairing code
--local     start locally this time, ignoring saved remote-access settings

${HEADLESS_USAGE}

Install once with \`npm install -g alcabots\`, then type \`alcabots\`.
Or run without a global install: \`npx alcabots\`. Node 24+ is required.
`;
