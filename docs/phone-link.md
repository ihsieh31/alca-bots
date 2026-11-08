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

Both sides meet at a relay, then move to a direct connection when the network allows it. Direct connections are on by default. To find a direct path, both devices ask public STUN servers from Cloudflare and Google for their network address; to avoid that, turn it off under **Relay and connection** and stay on the relay.

| What can see what | |
|---|---|
| The relay | Encrypted bytes, sizes, timing and IP addresses. It has no key and stores nothing. |
| The site serving the phone page | That you loaded the page. It delivers the page's code, so you are trusting it the way you trust any web app: host it yourself if that matters to you. |
| The phone | What its access level allows, enforced by the computer. It can never reach the computer's own sign-in, pairing or phone settings. |

The pairing code proves both sides to each other (SPAKE2), so a relay that tries to stand in the middle fails the pairing. Afterwards each side pins the other's key.

An organization that turns off remote access also blocks new phone pairings and refuses requests from phones already paired.

## What stays on the phone

The page keeps an encrypted copy of what it last showed (your partners, recent conversations, settings) so it opens at once and stays readable when the computer is off. The copy is sealed with a key the page can use but can't read out; someone with the unlocked phone's browser storage holds both, so treat it like the phone's other app data. Removing the phone, or pairing it with another computer, erases the copy.

## Notifications

Turn them on under **More → Notifications**. The computer encrypts each notification to your phone and hands it to your browser's push service (Apple, Google, Mozilla or Microsoft), so that service sees when one arrives and how large it is, but not what it says. The computer sends nothing to the relay for this, and no notification reaches a phone that is showing the app.

What a notification says can appear on your lock screen. Your phone's own notification settings control that.

## Watch and take over the bot's browser

While a bot is using its browser, **Watch** appears in the conversation. Pinch to zoom. **Take over** pauses the bot's browsing and lets you tap, scroll and type; **Hand back**, closing the window or leaving the app lets the bot continue.

## Host your own relay

Set the address under **Settings → Remote access → Phone → Relay and connection**, or with `ALCA_LINK_RELAY_URL` and `ALCA_LINK_SITE_URL`.

**On any server with Node 24:**

```sh
pnpm build:phone
node --experimental-strip-types link/relay/main.ts --site dist-phone --host 127.0.0.1 --port 8787 --trust-proxy
```

Put it behind your own HTTPS proxy, or pass `--tls-cert` and `--tls-key`. Phones need HTTPS for the page's encryption to work.

**On Cloudflare Workers:** deploy `link/relay-worker` with Wrangler, and host `dist-phone/` on any static host (`link/site-worker` does this on Cloudflare; change its domain to yours). Set the relay address when you build the site with `VITE_LINK_RELAY_URL`, and allow the site with the relay's `ALLOWED_ORIGINS`.

## Limits

- A relay carries at most 1 MiB/s per connection, so large files move slowly until the connection is direct.
- Phone access is off until you turn it on.
- The phone can watch and take over a bot's browser (ego lite). A VM, a VPS or a cloud desktop still opens as screenshots, without takeover.
- Notifications need an iPhone to have the page on its Home Screen, and a phone's browser to support Web Push.
