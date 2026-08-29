# tariorg

A member-governed **Organization** on [Ootle](https://ootle.tari.com/), Tari's
layer-2 smart-contract network.

`tariorg` is a small vertical slice that spans the whole stack: a WASM
smart-contract template, a CLI, and a web UI for creating and governing an
organization with a treasury.

> **Status: toy / exploration.** This project exists to explore what Ootle makes
> possible (components, templates, access rules, `invoke`, indexer-driven UIs,
> wallet-daemon auth, and so on). It may grow into a real project if there's
> interest in organizations on Ootle.

## Live demo

**[🔗 Live demo](https://tariorg.pages.dev)**

## What it is

An **Organization** is a component with:

- **Members** identified by the top-level transaction signer's public key
- **Treasury vaults** — the organization can hold and spend resources.
- **Governance proposals** with a configurable `threshold_ratio` (quorum). A
  proposal can:
  - add a member,
  - remove a member,
  - send funds from the treasury,
  - `invoke` an arbitrary method on another component.

### Repository layout

| Directory        | What it is                                                               |
| ---------------- | ------------------------------------------------------------------------ |
| `tariorg/`       | The Organization **template** (compiled to WASM) and its template tests. |
| `tariorg_types/` | Types shared between the template and the CLI.                           |
| `tariorg-cli/`   | Command-line client (`tariorg-cli`) for managing an organization.        |
| `webui/`         | React (React Router) SPA for creating and browsing organizations.        |

## Prerequisites

- **Rust nightly** — the template uses `#![feature(integer_casts)]` and
  `#![feature(float_conversions)]`, so stable won't build the workspace.
- The **`wasm32-unknown-unknown`** target for the template:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Node.js 22+** for the web UI (React Router requires `> 22.22.0`).

## Run it locally

There are two ways to use it: the **web UI against a local network**, or the
**CLI** directly.

### 1. Web UI + localnet (recommended)

`tariorg-cli e2e-infra` downloads the Ootle + Minotari binaries, boots a local
network (validator, indexer, wallet daemon), builds and publishes the
Organization template, funds a default account, and writes the web UI config —
then keeps the network running in the foreground.

```bash
# Terminal 1 — build the CLI and boot the localnet (Ctrl+C to stop).
cargo run -p tariorg-cli -- e2e-infra

# Terminal 2 — install deps (first time) and start the web UI.
cd webui
npm install
npm run dev
```

Open <http://localhost:5173>. The UI auto-detects the wallet daemon auth method
(`api-key` by default; use `--walletd-auth-method none` or `webauthn` to try the
others) and can also create ephemeral in-browser demo accounts.

### 2. CLI against Esmeralda

`tariorg-cli` talks directly to the public testnet (Esmeralda) and keeps its
state in `./state.json` (gitignored — it contains your secret keys).

```bash
# Create an account and fund it from the faucet.
cargo run -p tariorg-cli -- init

# Optional: add more member accounts.
cargo run -p tariorg-cli -- add-user

# Deploy an Organization with the members from state.
cargo run -p tariorg-cli -- create

# Inspect it.
cargo run -p tariorg-cli -- show

# Govern it (propose -> vote -> execute).
cargo run -p tariorg-cli -- propose-add-member <public-key>
cargo run -p tariorg-cli -- vote <proposal-id> true
cargo run -p tariorg-cli -- execute <proposal-id>

# Fund the treasury.
cargo run -p tariorg-cli -- deposit 42
```

Run `cargo run -p tariorg-cli -- --help` for the full command list.

## Development

```bash
# Rust: format, lint, and test the whole workspace.
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Web UI: typecheck and production build.
cd webui
npm run typecheck
npm run build
```

### End-to-end tests

```bash
# Terminal 1 — boot the localnet (foreground).
cargo run -p tariorg-cli -- e2e-infra

# Terminal 2 — run the Cypress suite against it.
cd webui && npm run test:e2e
```

See [`webui/E2E.md`](webui/E2E.md) for details on the e2e harness and its
configuration knobs.

## CI/CD

GitHub Actions run on every PR: Rust (fmt / clippy / test), web UI typecheck,
and the Cypress e2e suite on a Linux localnet. Merges to `main` build and deploy
the web UI to Cloudflare Pages, and PRs get a Cloudflare Pages preview.

## License

[The Unlicense](https://unlicense.org/) — this software is released into the public domain.
