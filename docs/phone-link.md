# Use AlcaBots from your phone

Your phone uses a web page, with no app to install. The page connects to your own computer or server through an end-to-end encrypted link. The computer keeps doing all the work; if it is off, the phone waits.

## Connect a phone

**With a screen on the computer:** open **Settings → Remote access → Phone**, turn on **Allow phone access**, and choose **Connect a phone**. Scan the QR code with the phone's camera, then choose **Connect**.

**Without a screen** (a VPS, a cloud host, a Mac mini in a closet), run this on that machine while AlcaBots is running:

```sh
npx alcabots phone          # full access
npx alcabots phone --daily  # chat, approvals and reading only
```

It turns phone access on and prints a QR code and a nine-digit code. The code is single-use and expires after five minutes. Nothing needs to listen on a public port or a domain, because the computer connects outward to the relay.

On an iPhone, add the page to your Home Screen first, then pair from there: Home Screen pages keep their own storage, so a pairing made in Safari does not carry over.

To remove a phone, use **Remove** next to it in Settings. It loses access at once.

## How it connects

Both sides meet at a relay, then move to a direct connection when the network allows it. Direct connections are off by default, because they ask a public STUN server for your network address; turn them on under **Relay and connection**.

| What can see what | |
|---|---|
| The relay | Encrypted bytes, sizes, timing and IP addresses. It has no key and stores nothing. |
| The site serving the phone page | That you loaded the page. It delivers the page's code, so you are trusting it the way you trust any web app: host it yourself if that matters to you. |
| The phone | What its access level allows, enforced by the computer. It can never reach the computer's own sign-in, pairing or phone settings. |

The pairing code proves both sides to each other (SPAKE2), so a relay that tries to stand in the middle fails the pairing. Afterwards each side pins the other's key.

An organization that turns off remote access also blocks new phone pairings and refuses requests from phones already paired.

## Host your own relay

Set the address under **Settings → Remote access → Phone → Relay and connection**, or with `ALCA_LINK_RELAY_URL` and `ALCA_LINK_SITE_URL`.

**On any server with Node 24:**

```sh
pnpm build:phone
node --experimental-strip-types link/relay/main.ts --site dist-phone --host 127.0.0.1 --port 8787 --trust-proxy
```

Put it behind your own HTTPS proxy, or pass `--tls-cert` and `--tls-key`. Phones need HTTPS for the page's encryption to work.

**On Cloudflare Workers:** deploy `link/relay-worker` with Wrangler, and host `dist-phone/` on any static host. Set the relay address when you build the site with `VITE_LINK_RELAY_URL`.

## Limits

- A relay carries at most 1 MiB/s per connection, so large files move slowly until the connection is direct.
- Phone access is off until you turn it on.
- The phone can't show the computer's desktop yet.
