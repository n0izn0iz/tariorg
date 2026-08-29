# Web UI end-to-end tests

Cypress e2e tests for the tariorg web UI, run against a **localnet**.

## Prerequisites

The e2e suite drives the real UI against a live Ootle network, so before
running it you need a localnet with:

1. A running **wallet daemon** (`walletd`) exposing JSON-RPC on the port the
   dev server proxies `/walletd` to.
2. A running **indexer** reachable by the UI.
3. The **Organization template** compiled to WASM and published on that network.
4. A **funded default account** in the wallet daemon.

`tariorg-cli e2e-infra` automates all four: it downloads the two release
bundles a local Ootle network needs — the tari-ootle bundle (wallet daemon,
indexer, validator node, swarm daemon) and the Minotari L1 suite (base-layer
node, console wallet, miner) — compiles the Organization template to WASM,
boots a local swarm (as a managed child process), discovers the
swarm-allocated wallet daemon + indexer ports, publishes the template through
the wallet daemon's JSON-RPC, then writes `.env.local` and
`cypress/fixtures/localnet.json`. It then keeps the network running in the
foreground until you stop it with `Ctrl+C`.

## One-time setup

```bash
# 1. Install webui dependencies (adds Cypress + start-server-and-test).
cd webui && npm install && cd ..

# 2. Download binaries, build + publish the template, boot the localnet and
#    write config + fixture. Runs in the foreground until Ctrl+C.
cargo run -p tariorg-cli -- e2e-infra

# Use `--walletd-auth-method none` to boot without minting an API key, so the
# webui auto-detects and authenticates against the wallet daemon's `none` auth
# path instead of the default `api-key` path.
cargo run -p tariorg-cli -- e2e-infra --walletd-auth-method none

# Use `--walletd-auth-method webauthn` to fund + publish under `none`, then
# reboot the daemon in `webauthn` mode keeping the wallet store. The webui then
# drives the passkey register/login flow in the browser.
cargo run -p tariorg-cli -- e2e-infra --walletd-auth-method webauthn
```

The command pins the tari-ootle / Minotari release versions at the top of
`tariorg-cli/src/e2e_infra.rs` (`OOTLE_VERSION`, `MINOTARI_VERSION`, etc.).
Bump them together to move releases. The published template address is written
straight into `webui/.env.local` as `VITE_TEMPLATE_ADDRESS`.

The `dao-lifecycle` spec reads `cypress/fixtures/localnet.json` to learn the
default account's public key (so the account is added as the org's initial
member). The home / new-org specs are client-side only and need no fixture.

## Running

```bash
# Headless (starts the dev server, waits for it, runs Cypress).
# Run this in a second terminal while `e2e-infra` keeps the localnet alive.
cd webui && npm run test:e2e

# Interactive (useful for writing/debugging; start the dev server separately):
npm run dev        # in one terminal
npm run cy:open    # in another

# Stop the localnet: press Ctrl+C in the terminal running `e2e-infra`.
```

## What is tested

- `cypress/e2e/home.cy.ts` — hero, features, roadmap, empty-orgs state,
  navigation to the create page.
- `cypress/e2e/new-org.cy.ts` — form rendering, member-address validation,
  add/remove member rows.
- `cypress/e2e/dao-lifecycle.cy.ts` — create an org, then propose → vote →
  execute end-to-end (requires the localnet + fixture).

## Configuration knobs

The UI reads these `VITE_*` environment variables (see `lib/config.ts`):

| Variable                | Default                 | Purpose                                                                                                                                        |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_NETWORK`          | `Esmeralda`             | `Esmeralda` or `LocalNet`                                                                                                                      |
| `VITE_INDEXER_URL`      | network default         | Override the indexer URL                                                                                                                       |
| `VITE_TEMPLATE_ADDRESS` | hardcoded               | Published Organization template address (set by the e2e-infra command)                                                                         |
| `VITE_WALLETD_API_KEY`  | unset                   | walletd JSON-RPC API key; when unset, the UI authenticates via the daemon's configured `none`/`webauthn` method (set by the e2e-infra command) |
| `VITE_WALLETD_TARGET`   | `http://localhost:5100` | walletd proxy target (read by `vite.config.ts`)                                                                                                |
