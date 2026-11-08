# Deploy AlcaBots on a VPS

From a blank Linux server to AlcaBots running on it around the clock, reachable from your laptop, the desktop app and your phone, with your bots working while every laptop is closed. It assumes nothing beyond being able to open a terminal and paste commands. About twenty minutes, most of it waiting.

Three ways to reach the server are covered. Pick one; the rest of the guide is the same.

| | You need | Who can reach it | Best for |
|---|---|---|---|
| **A. Phone link, no domain** (`serve`, then `phone`) | nothing else | phones you pair, end-to-end encrypted through a relay | the fastest path; a phone on cellular |
| **B. Your own domain** (Docker + Caddy) | a domain name, ports 80/443 | anyone with a pairing code, over HTTPS | a permanent address you own |
| **C. Your Tailscale network** (`serve --tailscale`) | Tailscale on the server and your devices | only your tailnet | the most private; nothing public at all |

Whichever you pick, the login is the same: you **pair** each device once with a short code and it stays signed in. A session lasts 30 days; using it with half that or less left renews it to a full 30, up to 180 days from pairing (`ALCA_SESSION_TTL_DAYS` and `ALCA_SESSION_MAX_DAYS` change both numbers). There is no password.

## Hetzner launch check (2026-09-07)

Path A was exercised on a blank Hetzner CX43 (x86-64, Ubuntu 24.04), using
Node 24.20.0 and Codex 0.153.4. The published 0.1.60 baseline was followed by
local candidate fixes from this change; these results do not certify the
unmodified published 0.1.60 package.

The paired web UI completed a real GPT-6-Astra chat, two automatically
scheduled routine runs, and a browser title/screenshot test with the
browser engine AlcaBots used then. A full reboot restored the service
and managed tunnel automatically; the existing paired device, bots, chats,
and paused schedule remained available. A new real chat turn also succeeded.

A stopped application-data backup restored with matching file hashes and
SQLite integrity. The restored copy was not started; provider reauthentication
and browser-login migration were not tested. Docker, Tailscale, ARM64, other
providers, and capacity limits were outside this run.

## What runs on a server, and what does not

Runs fully on the server: every engine CLI (Claude Code, Codex, Grok, custom ACP engines), chats, rooms, bot-to-bot coordination, routines, connected apps and custom MCP servers, webhooks, Company Brain, computer use on cloud or container computers, text-to-speech, and the web UI (the server serves it itself).

Needs the desktop app instead: dictation, controlling the server's own desktop, and the bots' browser (ego lite runs only on macOS and Windows desktops).

## Before you start

1. **A server.** Any Linux VPS: Ubuntu 22.04 or 24.04, 2 CPUs and 4 GB of RAM is plenty. You need `sudo` or root. Hetzner, DigitalOcean, Lightsail, a Mac mini in a cupboard: all fine.
2. **Node 24 or newer** for paths A and C (`node --version`). On Ubuntu:

   ```sh
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs
   ```

   Path B uses Docker instead and needs no Node on the host.
3. **Your engine accounts.** Bots run on the same engine CLIs you use on your laptop, with your subscriptions. You sign them in on the server once, the same way.

Connect to the server for everything below:

```sh
ssh root@YOUR_SERVER_IP
```

For paths A and C, use the same unprivileged Linux account for setup and the
running service. The examples below use `alca` with home `/home/alca`. From an
administrator shell, create it if it does not already exist, then switch to it:

```sh
sudo useradd --create-home --shell /bin/bash alca
sudo -iu alca
```

The login shell also changes into `/home/alca`; run setup there, not from `/root`.
Run the `npx` commands and engine sign-ins below in this account. Keep a separate
administrator shell for system packages and systemd. If you already signed in as
root, sign in again as `alca`; those accounts have different homes and credentials.

## Path A: a phone link

No domain, no proxy, no open port. The server connects outward to a relay, and your phone meets it there with an end-to-end encrypted link.

```sh
npx alcabots setup   # once: choose AI access, connect, and choose a model
npx alcabots serve   # keep it running
npx alcabots phone   # in another terminal: prints a code for your phone's browser
```

Use Codex's device-code option over SSH, or enter a hidden API key for a chat-only connection. More engines can be added later. See [CLI setup](cli-onboarding.md) and [Use AlcaBots from your phone](phone-link.md).

Skip to "Install and sign the engines in".

## Path B: your own domain, with Docker

One container for the server plus Caddy for HTTPS at `https://alca.example.com`.

1. **Point a name at the server.** In your DNS provider add an **A record** (name `alca`, value the server's public IP). After a few minutes `ping alca.example.com` should answer with that IP. Ports 80 and 443 must be open; most providers open them by default.
2. **Install Docker:**

   ```sh
   curl -fsSL https://get.docker.com | sh
   docker compose version   # prints a version; if "command not found", log out and back in
   ```

3. **Get the deploy files and set the name:**

   ```sh
   git clone https://github.com/ihsieh31/alca-bots && cd AlcaBots/deploy
   cp .env.example .env
   nano .env                # DOMAIN=alca.example.com ; ENGINES=@anthropic-ai/claude-code @openai/codex
   ```

   `ENGINES` lists the engine CLIs baked into your image, separated by spaces. Change it later and rebuild if you add one.

4. **Start it:**

   ```sh
   docker compose pull alca && docker compose up -d
   docker compose ps        # alca "healthy", caddy "running"
   ```

   Caddy requests the certificate on its own; give it a minute. Then `https://alca.example.com` shows a page asking for a pairing code. That is correct: nothing works until you pair.

In this path, every `npx alcabots …` command below is run inside the container instead:

```sh
docker compose exec alca node dist-server/alcabots.js pair --label "My MacBook"
```

## Path C: only your Tailscale network

From the administrator shell, install Tailscale on the server and sign in (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`). Enable HTTPS certificates for your tailnet once in the admin console (DNS → HTTPS Certificates), then run this from the `alca` shell:

```sh
npx alcabots serve --tailscale
```

Tailscale terminates HTTPS with its own certificate and the pairing link uses the server's MagicDNS name (`https://alca.tail1234.ts.net`). Only devices on your tailnet can reach it, which is a very good property for a server that can run tools.

## Install and sign the engines in

The npm AlcaBots package does not install model engine CLIs. For paths A and C,
install the engine you use in the service account, then sign it in. For example,
from the `alca` shell, for Claude:

```sh
npm install --global --prefix "$HOME/.local" @anthropic-ai/claude-code
export PATH="$HOME/.local/bin:$PATH"
claude
```

For Codex, use `@openai/codex` as the npm package and run `codex login --device-auth`
to sign in from a headless server. Complete the CLI's account flow in your browser. Repeat only for the
engines you use. For path B, run the installed CLI inside the container, for
example `docker compose exec alca claude`.

Engine logins belong to the service user's home (for example `~/.codex` and
`~/.claude`), separately from AlcaBots's `~/.alcabots`. Keep that home when
restarting or upgrading. The systemd example below includes `~/.local/bin` in PATH.

## Pair your first device

`serve` already printed a pairing link and QR code when it started. For another device later:

```sh
npx alcabots pair --label "Kitchen iPad"
```

```
pairing code:  RR8Y-BLR6-H939
expires:       10:59:45 AM (single use)
open or scan:  https://c-7f3a9c.alca-corp.me/pair#code=RR8Y-BLR6-H939
```

- **A browser:** open the link. The code is filled in; press **Connect**. That browser is paired for 30 days, renewed on use as above.
- **The desktop app:** copy the link, then in the app's **Server** menu choose **Add Server from Copied Pairing Link…**. The menu switches between your own machine and every server you added.
- **The phone:** scan the QR code from the iOS app's pairing screen, or paste the whole link into its address field. The phone can chat, approve, and read; creating bots, changing models, and connecting apps stay with you in the server's UI.

Worth knowing: a code works **once** and expires after **five minutes** (`--ttl 24h` keeps it open up to a day, for a device you set up later; it is still single use, and a server restart ends every open code); the link only works on that address (typing the code by hand: open `…/pair` and enter it); ten wrong codes in a minute from one address pause pairing for that address for a minute; `--client` mints a code for a device that may chat and approve but not change settings or pair others.

## Manage devices

Every paired device is a session:

```sh
npx alcabots sessions              # id, device, scope, last seen, expires
npx alcabots sessions revoke ID    # signs that device out and closes its stream at once
npx alcabots status                # what the server says about itself
```

## Keep it running

`npx alcabots serve` is a plain foreground process. For systemd (paths A and C),
install a chosen release first, from the `alca` shell. Replace `X.Y.Z` with the
published version you want to run:

```sh
npm install --global --prefix "$HOME/.local" alcabots@X.Y.Z
```

Stop the foreground server with Ctrl-C before enabling the service. From the
administrator shell, save this as `/etc/systemd/system/alcabots.service`:

```ini
# /etc/systemd/system/alcabots.service
[Unit]
Description=AlcaBots server
After=network-online.target

[Service]
User=alca
WorkingDirectory=/home/alca
Environment=HOME=/home/alca
Environment=PATH=/home/alca/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/alca/.local/bin/alcabots serve --no-pair
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now alcabots
journalctl -u alcabots -f            # the server's log
```

Add `--tailscale` for path C. `--no-pair` skips printing a code at every restart; mint one with `npx alcabots pair` when you need it. Docker (path B) restarts on its own (`restart: unless-stopped`).

Adjust the account, home, and PATH if yours differ; Node 24 must be available on
that PATH. The service runs the installed CLI directly, so a restart uses the
same release without an npm install prompt or an implicit upgrade.

## Update

- **Paths A and C with the service above:** choose the new published version,
  then run these commands from the administrator shell, replacing `X.Y.Z`:

  ```sh
  sudo systemctl stop alcabots
  sudo -iu alca npm install --global --prefix /home/alca/.local alcabots@X.Y.Z
  sudo systemctl start alcabots
  ```

  Check that installation succeeded before starting. A service restart by itself
  does not update the installed package. For foreground `npx` usage, specify the
  desired release as `npx --yes alcabots@X.Y.Z serve`.
- **Path B:** `cd AlcaBots/deploy && docker compose pull alca && docker compose up -d`.

Routines and queued work survive a restart. A teammate turn running at that moment runs again once at the next start, told to check what it already did, and the bot that asked for it is told. A person's own turn and a running routine are not run again: the conversation says it was interrupted. Update between runs where you can.

## Back up

Stop the server before copying its SQLite database: Ctrl-C for a foreground
process, or `sudo systemctl stop alcabots` from the administrator shell for
the service above. Stop any engine processes and managed desktops still writing
files you intend to back up.

For paths A and C, this backs up application state (bots, chats, routines, tunnel
credentials, and paired sessions). Run it from the service account's shell:

```sh
umask 077
backup_dir=$(mktemp -d "$PWD/alcabots-backup.XXXXXX")
tar czf "$backup_dir/alcabots-data.tgz" -C "$HOME" .alcabots
```

A full backup also needs your engine credential/configuration paths, such as
`~/.codex`, `~/.claude` and `~/.claude.json`, Include the paths that exist for your installed CLIs,
any configured home/data-directory overrides, and workspaces outside the app
directory. These are not included in the command above.

For path B, the whole `/data` volume includes the container's CLI homes. From
`AlcaBots/deploy`, stop the app before archiving; `deploy_data` is the default
volume name, so use your actual volume name if you changed the Compose project:

```sh
docker compose stop alca
backup_dir=$(mktemp -d "$PWD/alcabots-backup.XXXXXX")
docker run --rm -v deploy_data:/data:ro -v "$backup_dir":/b alpine sh -c 'umask 077; tar czf /b/alcabots-data.tgz -C /data .'
```

Each command creates a fresh private folder in the current directory, so it
cannot overwrite an older archive with more permissive access. Keep the
archive inside that folder privately on another machine. Restore with the server stopped,
using the same paths and original ownership. After backup or restore, start the
service with `sudo systemctl start alcabots`, or `docker compose start alca`.

## The rules the setup relies on

Read this before putting anything else in front of the server.

- The server only ever listens on loopback (`127.0.0.1:8799`). Never publish that port yourself. The tunnel, Caddy and Tailscale each reach it from the same machine.
- A request that arrives through a proxy or the tunnel is treated as remote and needs a session, whatever headers it carries. A proxy of your own (nginx, Traefik, Cloudflare Tunnel) must forward the real `Host` and add `X-Forwarded-For` and `X-Forwarded-Proto`, must not buffer the event stream, and must **not** rewrite `Host` to `127.0.0.1`.
- Pairing is the login. Want a second wall in front of it? Path B's `Caddyfile` has a commented `basic_auth` block for a shared password.
- The session cookie is marked `Secure`; do not serve this over plain HTTP on the public internet.
- The one thing a stranger can read is `/.well-known/alcabots/environment` (the server's id, label, version, capabilities) and `/api/health` (only the app name). Everything else answers "pair this device".

## Troubleshooting

**Path B: the page never loads or shows a certificate error.** Caddy could not get a certificate. Check that the name resolves to the server and that ports 80 and 443 are open; `docker compose logs caddy` shows the reason.

**"forbidden: pair this device to use the server remotely" / "this request came through a proxy".** Expected before pairing, and for tools that call the API without a session. Pair the device. Scripts send `Authorization: Bearer <token>` with the token from the pairing response instead of a cookie.

**Pairing code refused.** It expired (five minutes, or its `--ttl`) or was used. Mint a new one. "Too many failed pairing attempts" means wait a minute.

**A bot says the engine is not signed in.** Sign that engine in again on the server.

**What does the server think it is?** `https://<address>/.well-known/alcabots/environment` is public and shows its id, label, version and capabilities; `npx alcabots status` prints the same on the server.

**Something else.** `journalctl -u alcabots --since -10m` (or `docker compose logs alca --tail 100`) shows the server's startup lines. Paste them with your question in the community channel.

