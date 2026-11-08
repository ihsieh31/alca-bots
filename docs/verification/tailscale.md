# Tailscale standalone CLI discovery

The macOS app executable chooses GUI or CLI mode from its environment.
Finder-launched ALCA processes must set `TAILSCALE_BE_CLI=1`, including when
using the self-hosted server's `tailscale serve` support. No installed wrapper,
interactive shell, or change to the user's environment is required.

## Offline verification

```sh
pnpm exec vitest run server/tailscale.test.ts
```

Every CLI launch is routed to an offline child process; it never runs the
installed Tailscale or changes a real tailnet. Without the CLI environment flag
the child exits successfully with GUI startup text, reproducing the reported
failure.

The assertions cover explicit CLI mode for self-hosted status, HTTPS Serve, and
Serve off. This proves the control contract, not a particular customer's
Tailscale installation.
