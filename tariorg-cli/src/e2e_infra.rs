//! `tariorg-cli e2e-infra` — boot a local Ootle network for the webui Cypress
//! suite, publish the Organization template, and keep the network running in
//! the foreground until it is stopped.
//!
//! This replaces the old `scripts/setup-localnet.sh`. The swarm daemon runs as
//! a managed child process and is torn down on `Ctrl+C` (SIGINT), rather than
//! being backgrounded in a shell. Downloads and JSON-RPC go through `reqwest`
//! instead of `curl`.

use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine as _;
use clap::{Args, ValueEnum};
use reqwest::Client;
use serde_json::{Value, json};
use sha2::Digest as _;
use tracing::{info, warn};

// ─────────────────────────────────────────────────────────────────────────────
// Version / release configuration. Bump these together when moving to a new
// release. COMMIT is the short commit hash embedded in each asset filename.
// ─────────────────────────────────────────────────────────────────────────────
const OOTLE_VERSION: &str = "0.40.0";
const OOTLE_COMMIT: &str = "4e71037";
const MINOTARI_VERSION: &str = "5.6.0";
const MINOTARI_COMMIT: &str = "b006631";
const MINOTARI_NETWORK: &str = "esme"; // esme | mainnet
const OOTLE_NETWORK: &str = "localnet";
/// The wallet daemon's `--wallet-daemon-auth` value for the two bootstrap
/// stages. The first boot always runs `none` so the CLI can log in anonymously
/// to fund the account and publish the template; `webauthn` is used only for the
/// final boot in webauthn mode (with the wallet store kept from the first boot).
const DAEMON_AUTH_NONE: &str = "none";
const DAEMON_AUTH_WEBAUTHN: &str = "webauthn";
/// Fixed wallet encryption password for the localnet wallet daemon. The default
/// OS keyring is unavailable on headless Linux (e.g. GitHub Actions), which makes
/// `tari_ootle_walletd` exit with "OS keyring not supported". Overriding the
/// keyring with a fixed password lets it start without one.
const WALLETD_PASSWORD: &str = "password";

/// The swarm daemon's own JSON-RPC webserver port (default from its config's
/// `webserver.bind_address`). Used to discover the wallet/indexer ports.
const SWARM_WEB_PORT: u16 = 8080;

/// The webui dev-server port (`vite.config.ts` binds here). In webauthn mode the
/// wallet daemon's WebAuthn relying-party origin must match this origin, so we
/// tell it to accept `http://localhost:{WEBUI_DEV_PORT}`.
const WEBUI_DEV_PORT: u16 = 5173;

const GITHUB_RELEASES_OOTLE: &str = "https://github.com/tari-project/tari-ootle/releases/download";
const GITHUB_RELEASES_TARI: &str = "https://github.com/tari-project/tari/releases/download";

/// Which auth method the webui ends up using (it auto-detects this). The value
/// controls how the harness bootstraps the wallet daemon:
/// - `api-key`: boot `none`, mint a key, hand it to the webui.
/// - `none`: boot `none`, no key (the webui logs in anonymously).
/// - `webauthn`: boot `none` to fund/publish, then reboot in `webauthn` mode
///   keeping the wallet store; no key is handed out, so the webui does the
///   passkey flow.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum WalletdAuthMethod {
    /// Mint a long-lived API key and hand it to the webui.
    ApiKey,
    /// Don't mint a key; the webui logs in anonymously and keeps a JWT.
    None,
    /// Flip the daemon to webauthn after setup; the webui uses a passkey.
    Webauthn,
}

#[derive(Args)]
pub struct E2eInfraArgs {
    /// Base directory for downloaded binaries and swarm state.
    #[arg(long, default_value = ".localnet")]
    pub base_dir: PathBuf,

    /// Auth strategy the webui will auto-detect (api-key mints a key, none
    /// doesn't, webauthn reboots the daemon in webauthn mode after setup).
    #[arg(long, value_enum, default_value_t = WalletdAuthMethod::ApiKey)]
    pub walletd_auth_method: WalletdAuthMethod,
}

struct Paths {
    base_dir: PathBuf,
    bin_dir: PathBuf,
    swarm_dir: PathBuf,
    log_file: PathBuf,
    wasm: PathBuf,
    env_local: PathBuf,
    fixtures_dir: PathBuf,
    fixture: PathBuf,
}

impl Paths {
    fn new(base_dir: PathBuf, webui_dir: &Path, workspace_dir: &Path) -> Self {
        let base_dir = if base_dir.is_absolute() {
            base_dir
        } else {
            webui_dir.join(base_dir)
        };
        Self {
            bin_dir: base_dir.join("bin"),
            swarm_dir: base_dir.join("swarm"),
            log_file: base_dir.join("swarm.log"),
            wasm: workspace_dir.join("target/wasm32-unknown-unknown/release/tariorg.wasm"),
            env_local: webui_dir.join(".env.local"),
            fixtures_dir: webui_dir.join("cypress/fixtures"),
            fixture: webui_dir.join("cypress/fixtures/localnet.json"),
            base_dir,
        }
    }
}

pub async fn run(args: E2eInfraArgs) -> Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .without_time()
        .init();

    let workspace_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("no parent of CARGO_MANIFEST_DIR")?
        .to_path_buf();
    let webui_dir = workspace_dir.join("webui");
    let paths = Paths::new(args.base_dir, &webui_dir, &workspace_dir);
    let walletd_auth_method = args.walletd_auth_method;

    let client = Client::new();

    info!(
        "tari-ootle v{OOTLE_VERSION} (commit {OOTLE_COMMIT}) + Minotari v{MINOTARI_VERSION} — {}",
        detect_platform()?
    );

    download_bundles(&client, &paths).await?;
    extract_bundles(&paths)?;
    resign_jit_binaries(&paths)?;
    build_template(&paths)?;

    clean_swarm_state(&paths)?;

    // First boot is always `none`: the CLI needs anonymous login to fund the
    // account and publish the template (and, for api-key mode, mint a key).
    init_swarm(&paths, DAEMON_AUTH_NONE)?;
    let mut child = start_swarm(&paths, false)?;
    let mut pid = child.id().context("spawned process has no pid")?;

    let mut setup = match setup(&client, &paths, walletd_auth_method).await {
        Ok(setup) => setup,
        Err(err) => {
            warn!("setup failed; stopping swarm daemon (pid {pid})");
            let _ = stop_swarm(pid, &mut child).await;
            return Err(err);
        }
    };

    // webauthn: after setup, flip the daemon auth mode and reboot, keeping the
    // wallet store (api keys + account + on-chain state) intact. The webui then
    // auto-detects webauthn and drives the passkey flow in the browser. Ports
    // may be re-allocated on restart, so re-discover them before writing config.
    if walletd_auth_method == WalletdAuthMethod::Webauthn {
        stop_swarm(pid, &mut child).await?;
        init_swarm(&paths, DAEMON_AUTH_WEBAUTHN)?;
        enable_vite_dev(&paths)?;
        child = start_swarm(&paths, true)?;
        pid = child.id().context("spawned process has no pid")?;
        refresh_ports(&client, &mut setup).await?;
    }

    run_foreground(&paths, &mut child, pid, &setup).await
}

/// The artifacts produced by the setup phase, needed to write the webui config
/// and (for webauthn) decide whether to reboot before handing off.
struct Setup {
    pubkey: String,
    template_addr: String,
    indexer_url: String,
    walletd_port: u16,
    api_key: Option<String>,
}

/// Discover the swarm-allocated ports, fund the default account, and publish the
/// Organization template — all against a `none`-auth wallet daemon. Returns the
/// values needed to write the webui config.
async fn setup(
    client: &Client,
    paths: &Paths,
    walletd_auth_method: WalletdAuthMethod,
) -> Result<Setup> {
    wait_for_swarm(client).await?;

    let (walletd_port, indexer_url) = discover_ports(client).await?;
    let walletd_url = format!("http://127.0.0.1:{walletd_port}/json_rpc");
    info!("wallet daemon jrpc port {walletd_port}, indexer at {indexer_url}");

    wait_for_walletd(client, &walletd_url).await?;

    // The wallet daemon requires a bearer on every protected method even in
    // `authentication = none` mode. Log in anonymously to obtain a JWT, then
    // either mint a long-lived API key to hand to the webui (api-key mode) or
    // reuse the JWT for the rest of setup and let the webui log in itself
    // (none/webauthn mode).
    let jwt = authenticate_walletd(client, &walletd_url).await?;
    let (setup_token, api_key): (String, Option<String>) = match walletd_auth_method {
        WalletdAuthMethod::ApiKey => {
            let api_key = mint_api_key(client, &walletd_url, &jwt).await?;
            (api_key.clone(), Some(api_key))
        }
        WalletdAuthMethod::None | WalletdAuthMethod::Webauthn => (jwt, None),
    };

    let (pubkey, component_address) = fetch_account(client, &walletd_url, &setup_token).await?;
    info!("default account public key: {pubkey}");

    // The indexer discovers the validator through a one-shot seed-peer dial with
    // no retry (its networking worker drains the seed list once and never
    // re-dials). On a cold boot that dial races the validator's networking
    // startup and usually loses, leaving the indexer's peer store empty, which
    // surfaces as "No addresses for peer" on the first funding attempt.
    //
    // Normally mDNS papers over this: both nodes advertise via mDNS, so the
    // indexer backfills the validator's address even after the seed dial misses.
    // But macOS's "Local Network" privacy permission — scoped to the *terminal*
    // that spawned these binaries, not the binaries themselves — silently
    // disables mDNS when denied. That turns the latent race into a hard,
    // every-boot failure that looks like a regression but isn't (it was not the
    // CLI code, not a VPN, and not fixed by a reboot).
    //
    // Restarting the indexer re-runs that one-shot dial with the validator now
    // up, so funding no longer depends on mDNS or on winning the startup race.
    if let Err(err) = fund_account(client, &walletd_url, &component_address, &setup_token).await {
        if !is_network_not_ready(&err.to_string()) {
            return Err(err);
        }
        warn!("indexer can't reach the validator yet ({err}); restarting it once");
        restart_indexer(client).await?;
        retry_until_network_ready(Duration::from_secs(120), Duration::from_secs(3), || async {
            fund_account(client, &walletd_url, &component_address, &setup_token).await
        })
        .await?;
    }

    let template_addr = publish_template(
        client,
        &walletd_url,
        paths,
        &component_address,
        &pubkey,
        &setup_token,
    )
    .await?;

    Ok(Setup {
        pubkey,
        template_addr,
        indexer_url,
        walletd_port,
        api_key,
    })
}

/// After a webauthn reboot, wait for the swarm to come back up and refresh the
/// wallet daemon / indexer ports, which may be re-allocated across the restart.
async fn refresh_ports(client: &Client, setup: &mut Setup) -> Result<()> {
    wait_for_swarm(client).await?;
    let (walletd_port, indexer_url) = discover_ports(client).await?;
    let walletd_url = format!("http://127.0.0.1:{walletd_port}/json_rpc");
    info!("wallet daemon jrpc port {walletd_port}, indexer at {indexer_url}");
    wait_for_walletd(client, &walletd_url).await?;
    setup.walletd_port = walletd_port;
    setup.indexer_url = indexer_url;
    Ok(())
}

/// Write the webui config and keep the swarm running in the foreground until
/// Ctrl+C or the child exits.
async fn run_foreground(
    paths: &Paths,
    child: &mut tokio::process::Child,
    pid: u32,
    setup: &Setup,
) -> Result<()> {
    write_config(paths, setup)?;
    info!(
        "localnet is up and the Organization template is published at {}",
        setup.template_addr
    );

    println!();
    println!("The localnet is running in the foreground.");
    println!("Run the e2e suite in another terminal:");
    println!("    cd webui && npm run test:e2e");
    println!();
    println!("Press Ctrl+C to stop the localnet.");
    println!("Swarm logs: {}", paths.log_file.display());

    // Stay in the foreground, supervising the swarm daemon, until Ctrl+C or the
    // child exits on its own.
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("received Ctrl+C, stopping swarm daemon (pid {pid})");
            send_signal(pid, "INT")?;
        }
        status = child.wait() => {
            info!("swarm daemon exited on its own: {status:?}");
            return Ok(());
        }
    }

    // After Ctrl+C: wait for the swarm daemon to finish its graceful shutdown.
    match tokio::time::timeout(Duration::from_secs(15), child.wait()).await {
        Ok(_) => info!("swarm stopped"),
        Err(_) => {
            warn!("swarm daemon did not exit on SIGINT; sending SIGTERM");
            send_signal(pid, "TERM")?;
            child.wait().await?;
        }
    }

    Ok(())
}

/// Gracefully stop the swarm daemon and wait for it to release its lockfile.
async fn stop_swarm(pid: u32, child: &mut tokio::process::Child) -> Result<()> {
    info!("stopping swarm daemon (pid {pid})");
    send_signal(pid, "INT")?;
    match tokio::time::timeout(Duration::from_secs(30), child.wait()).await {
        Ok(_) => Ok(()),
        Err(_) => {
            warn!("swarm daemon did not exit on SIGINT; sending SIGTERM");
            send_signal(pid, "TERM")?;
            child.wait().await?;
            Ok(())
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform / paths
// ─────────────────────────────────────────────────────────────────────────────
fn detect_platform() -> Result<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("macos-arm64"),
        ("macos", "x86_64") => Ok("macos-x86_64"),
        ("linux", "aarch64") => Ok("linux-arm64"),
        ("linux", "x86_64") => Ok("linux-x86_64"),
        (os, arch) => bail!("unsupported platform: {os}/{arch}"),
    }
}

fn find_bin(bin_dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(bin_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
        if path.is_dir()
            && let Some(found) = find_bin(&path, name)
        {
            return Some(found);
        }
    }
    None
}

fn send_signal(pid: u32, signal: &str) -> Result<()> {
    let status = std::process::Command::new("kill")
        .arg(format!("-{signal}"))
        .arg(pid.to_string())
        .status()
        .context("failed to run kill")?;
    if !status.success() {
        bail!("kill -{signal} {pid} failed");
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Download + extract
// ─────────────────────────────────────────────────────────────────────────────
async fn download_bundles(client: &Client, paths: &Paths) -> Result<()> {
    let platform = detect_platform()?;
    std::fs::create_dir_all(&paths.bin_dir)?;

    let ootle_asset = format!("tari_ootle-{OOTLE_VERSION}-{OOTLE_COMMIT}-{platform}.zip");
    let ootle_url = format!("{GITHUB_RELEASES_OOTLE}/v{OOTLE_VERSION}/{ootle_asset}");
    download_asset(client, &ootle_url, &paths.bin_dir.join(&ootle_asset)).await?;

    let suite_asset = format!(
        "tari_suite-{MINOTARI_VERSION}-{MINOTARI_NETWORK}-{MINOTARI_COMMIT}-{platform}.zip"
    );
    let suite_url = format!("{GITHUB_RELEASES_TARI}/v{MINOTARI_VERSION}/{suite_asset}");
    download_asset(client, &suite_url, &paths.bin_dir.join(&suite_asset)).await?;

    Ok(())
}

async fn download_asset(client: &Client, url: &str, dest: &Path) -> Result<()> {
    if dest.exists() {
        info!("already present at {} (skipping download)", dest.display());
        return Ok(());
    }

    info!("downloading {url}");
    let bytes = client
        .get(url)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .with_context(|| format!("download failed: {url}"))?
        .error_for_status()
        .with_context(|| format!("download returned an error: {url}"))?
        .bytes()
        .await?;
    std::fs::write(dest, &bytes)?;

    info!("downloading {url}.sha256");
    let sha_bytes = client
        .get(format!("{url}.sha256"))
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .with_context(|| format!("download failed: {url}.sha256"))?
        .error_for_status()?
        .bytes()
        .await?;
    let sha_path = PathBuf::from(format!("{}.sha256", dest.display()));
    std::fs::write(&sha_path, &sha_bytes)?;

    let expected = std::str::from_utf8(&sha_bytes)?
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();
    let actual = hex::encode(sha2::Sha256::digest(&bytes));
    if expected != actual {
        bail!(
            "checksum mismatch for {} (expected {expected}, got {actual})",
            dest.display()
        );
    }
    info!("downloaded and verified {}", dest.display());
    Ok(())
}

fn extract_bundles(paths: &Paths) -> Result<()> {
    let platform = detect_platform()?;
    let assets = [
        format!("tari_ootle-{OOTLE_VERSION}-{OOTLE_COMMIT}-{platform}.zip"),
        format!(
            "tari_suite-{MINOTARI_VERSION}-{MINOTARI_NETWORK}-{MINOTARI_COMMIT}-{platform}.zip"
        ),
    ];

    for asset in assets {
        let zip_path = paths.bin_dir.join(&asset);
        info!("extracting {asset} into {}", paths.bin_dir.display());
        let status = std::process::Command::new("unzip")
            .arg("-oq")
            .arg(&zip_path)
            .arg("-d")
            .arg(&paths.bin_dir)
            .status()
            .with_context(|| format!("failed to run unzip for {asset}"))?;
        if !status.success() {
            bail!("unzip failed for {asset}");
        }
    }
    info!("extracted");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// macOS code-signing fix for the WASM JIT
// ─────────────────────────────────────────────────────────────────────────────
/// On macOS, wasmer's JIT (`sys`/cranelift backend) allocates writable+executable
/// pages to run WASM. The hardened runtime kills any process that does this
/// without the `com.apple.security.cs.allow-jit` entitlement, which the release
/// binaries do not carry. Re-sign the WASM-executing binaries ad-hoc with that
/// entitlement so they don't die with `SIGKILL (Code Signature Invalid)` the
/// first time they execute a template (e.g. the account template's constructor
/// during the faucet claim).
fn resign_jit_binaries(paths: &Paths) -> Result<()> {
    if std::env::consts::OS != "macos" {
        return Ok(());
    }

    let entitlements = paths.bin_dir.join("allow-jit.plist");
    std::fs::write(
        &entitlements,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
</dict>
</plist>
"#,
    )?;

    for bin in ["tari_validator_node", "tari_indexer"] {
        let bin_path = paths.bin_dir.join(bin);
        if !bin_path.exists() {
            continue;
        }
        info!("re-signing {bin} with the allow-jit entitlement");
        let status = std::process::Command::new("codesign")
            .arg("--force")
            .arg("--sign")
            .arg("-")
            .arg("--entitlements")
            .arg(&entitlements)
            .arg(&bin_path)
            .status()
            .with_context(|| format!("failed to run codesign for {bin}"))?;
        if !status.success() {
            bail!("codesign failed for {bin}");
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Template build
// ─────────────────────────────────────────────────────────────────────────────
fn build_template(paths: &Paths) -> Result<()> {
    let workspace_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("no parent of CARGO_MANIFEST_DIR")?;

    info!("building the Organization template (WASM)");
    let status = std::process::Command::new("cargo")
        .args([
            "build",
            "-p",
            "tariorg",
            "--target",
            "wasm32-unknown-unknown",
            "--release",
        ])
        .current_dir(workspace_dir)
        .status()
        .context("failed to run cargo build")?;
    if !status.success() {
        bail!("cargo build failed");
    }
    if !paths.wasm.exists() {
        bail!("WASM output not found at {}", paths.wasm.display());
    }
    info!("template built: {}", paths.wasm.display());
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Swarm daemon
// ─────────────────────────────────────────────────────────────────────────────
/// The swarm's `init --force` only overwrites the config file; it does not wipe
/// the per-process data directories (wallet keyrings, node databases, etc.). A
/// stale Minotari wallet keyring from a previous run makes validator
/// registration fail with `Decryption failed: aead::Error`, so we clear the
/// swarm state before every fresh boot.
fn clean_swarm_state(paths: &Paths) -> Result<()> {
    if paths.swarm_dir.exists() {
        info!(
            "removing stale swarm state at {}",
            paths.swarm_dir.display()
        );
        std::fs::remove_dir_all(&paths.swarm_dir)
            .with_context(|| format!("failed to remove {}", paths.swarm_dir.display()))?;
    }
    Ok(())
}

fn swarm_bin(paths: &Paths) -> Result<PathBuf> {
    find_bin(&paths.bin_dir, "tari_swarm_daemon")
        .ok_or_else(|| anyhow!("tari_swarm_daemon not found in {}", paths.bin_dir.display()))
}

/// Run `swarm init --force` with the given wallet daemon auth mode. This only
/// overwrites the swarm's config.toml; it does not touch the per-process data
/// directories, so the wallet store survives a re-init with a different mode.
fn init_swarm(paths: &Paths, daemon_auth: &str) -> Result<()> {
    let swarm = swarm_bin(paths)?;
    info!("initializing swarm (network={OOTLE_NETWORK}, auth={daemon_auth})");
    let init = std::process::Command::new(&swarm)
        .arg("--base-dir")
        .arg(&paths.swarm_dir)
        .arg("--network")
        .arg(OOTLE_NETWORK)
        .arg("init")
        .arg("--force")
        .arg("--binaries-root")
        .arg(&paths.bin_dir)
        .arg("--no-compile")
        .arg("--wallet-daemon-auth")
        .arg(daemon_auth)
        .status()
        .context("failed to run swarm init")?;
    if !init.success() {
        bail!("swarm init failed");
    }
    set_walletd_password(paths)?;
    Ok(())
}

/// The wallet daemon uses the OS keyring to store a generated encryption
/// password. Headless Linux runners have no keyring, so the daemon exits with
/// "OS keyring not supported". Override the keyring with a fixed password so it
/// can start without one. This is written into the swarm `config.toml` because
/// the swarm daemon — not this CLI — spawns the wallet daemon.
fn set_walletd_password(paths: &Paths) -> Result<()> {
    let config_path = paths.swarm_dir.join("config.toml");
    let contents = std::fs::read_to_string(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    // Every instance has a `[instances.settings]` table. Both wallet instances
    // (the `create-account` "Create Key" step and the long-running daemon) read
    // `override_keyring_password` from it; the other process definitions ignore
    // unknown settings, so adding it to every instance is harmless.
    let needle = "[instances.settings]";
    if !contents.contains(needle) {
        bail!(
            "could not find `[instances.settings]` in {}; cannot set the wallet daemon password",
            config_path.display()
        );
    }
    let updated = contents.replace(
        needle,
        &format!("{needle}\noverride_keyring_password = \"{WALLETD_PASSWORD}\""),
    );
    std::fs::write(&config_path, updated)
        .with_context(|| format!("failed to write {}", config_path.display()))?;
    info!("set wallet daemon override_keyring_password (headless keyring workaround)");
    Ok(())
}

/// In webauthn mode, tell the wallet daemon to accept the webui dev server as
/// its WebAuthn relying-party origin. The swarm daemon forwards this as
/// `--vite-dev={port}` to the wallet daemon, which sets
/// `webauthn.rp_origin = http://localhost:{port}` (and permissive CORS).
fn enable_vite_dev(paths: &Paths) -> Result<()> {
    let config_path = paths.swarm_dir.join("config.toml");
    let contents = std::fs::read_to_string(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    let needle = "wallet_daemon_auth = \"webauthn\"";
    let updated = contents.replacen(
        needle,
        &format!("{needle}\nenable_vite_dev = \"{WEBUI_DEV_PORT}\""),
        1,
    );
    if updated == contents {
        bail!(
            "could not find `{needle}` in {}; cannot set webauthn rp_origin",
            config_path.display()
        );
    }
    std::fs::write(&config_path, updated)
        .with_context(|| format!("failed to write {}", config_path.display()))?;
    info!(
        "enabled vite-dev (webauthn rp_origin) for the webui dev server on port {WEBUI_DEV_PORT}"
    );
    Ok(())
}

/// Start the swarm daemon as a managed child process, capturing its output to
/// the swarm log. `skip_registration` is used on re-boots: the validator node
/// was already registered on the first boot and re-registering it fails with
/// "already registered".
fn start_swarm(paths: &Paths, skip_registration: bool) -> Result<tokio::process::Child> {
    let swarm = swarm_bin(paths)?;
    info!("starting swarm daemon (managed child process)");
    std::fs::create_dir_all(&paths.base_dir)?;
    let log = std::fs::File::create(&paths.log_file).context("failed to create swarm log")?;
    let mut command = tokio::process::Command::new(&swarm);
    command
        .arg("--base-dir")
        .arg(&paths.swarm_dir)
        .arg("--network")
        .arg(OOTLE_NETWORK)
        .arg("start");
    if skip_registration {
        command.arg("--skip-registration");
    }
    let child = command
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log))
        .spawn()
        .context("failed to spawn swarm daemon")?;

    info!(
        "swarm daemon spawned (pid {}, logs: {})",
        child.id().unwrap_or_default(),
        paths.log_file.display()
    );
    Ok(child)
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC helpers
// ─────────────────────────────────────────────────────────────────────────────
async fn json_rpc(client: &Client, url: &str, method: &str, params: Value) -> Result<Value> {
    json_rpc_with_timeout(client, url, method, params, None, Duration::from_secs(30)).await
}

/// Like [`json_rpc`], but sends the supplied bearer token in the
/// `Authorization` header. The wallet daemon requires a bearer (a JWT from
/// `auth.request`, or an API key minted with `auth.create_api_key`) on every
/// protected method, even in `authentication = none` mode.
async fn json_rpc_bearer(
    client: &Client,
    url: &str,
    method: &str,
    params: Value,
    token: Option<&str>,
) -> Result<Value> {
    json_rpc_with_timeout(client, url, method, params, token, Duration::from_secs(30)).await
}

/// [`json_rpc_bearer`] with an explicit request timeout. Used for RPCs that
/// block until a transaction finalizes (e.g. `accounts.create_free_test_coins`),
/// which can outlive the default 30s timeout on a freshly booted localnet.
async fn json_rpc_with_timeout(
    client: &Client,
    url: &str,
    method: &str,
    params: Value,
    token: Option<&str>,
    timeout: Duration,
) -> Result<Value> {
    let mut req = client.post(url).timeout(timeout).json(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }));
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let resp: Value = req
        .send()
        .await
        .with_context(|| format!("JSON-RPC call to {method} failed"))?
        .error_for_status()?
        .json()
        .await?;

    if let Some(err) = resp.get("error").filter(|e| !e.is_null()) {
        bail!("JSON-RPC error from {method}: {err}");
    }
    Ok(resp)
}

async fn poll_until<F, Fut>(timeout: Duration, interval: Duration, mut f: F) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<bool>>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if f().await? {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            bail!("timed out after {timeout:?}");
        }
        tokio::time::sleep(interval).await;
    }
}

/// Poll a fallible operation until it succeeds or `timeout` elapses. Unlike
/// `poll_until`, this returns the produced value rather than discarding it.
async fn poll_for_value<T, F, Fut>(timeout: Duration, interval: Duration, mut f: F) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    let start = tokio::time::Instant::now();
    let mut last_log = Duration::ZERO;
    loop {
        match f().await {
            Ok(value) => return Ok(value),
            Err(err) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(err);
                }
                let elapsed = tokio::time::Instant::now() - start;
                if elapsed.saturating_sub(last_log) >= Duration::from_secs(30) {
                    info!("still waiting ({elapsed:?} elapsed)...");
                    last_log = elapsed;
                }
                tokio::time::sleep(interval).await;
            }
        }
    }
}

fn swarm_url() -> String {
    format!("http://127.0.0.1:{SWARM_WEB_PORT}/json_rpc")
}

/// Find the `TariIndexer` instance id via the swarm daemon's `list_instances`.
async fn find_indexer_instance(client: &Client) -> Result<u32> {
    let body = json_rpc(
        client,
        &swarm_url(),
        "list_instances",
        json!({ "by_type": null }),
    )
    .await?;
    let instances = body["result"]["instances"]
        .as_array()
        .ok_or_else(|| anyhow!("no instances listed: {body}"))?;
    for inst in instances {
        if inst["instance_type"].as_str() == Some("TariIndexer")
            && let Some(id) = inst["id"].as_u64()
        {
            return Ok(id as u32);
        }
    }
    bail!("indexer instance not found in: {body}");
}

/// Restart the indexer instance. On a cold boot it dials its validator seed
/// before the validator is listening and never retries, leaving its peer store
/// empty ("No addresses for peer"). A fresh indexer re-runs that one-shot dial
/// with the validator now up. `start_instance` reuses the instance's allocated
/// ports, so it comes back on the same API port.
async fn restart_indexer(client: &Client) -> Result<()> {
    let id = find_indexer_instance(client).await?;
    info!("restarting indexer (instance {id}) so it re-dials the validator seed");
    json_rpc(
        client,
        &swarm_url(),
        "stop_instance",
        json!({ "by_id": id }),
    )
    .await?;
    json_rpc(
        client,
        &swarm_url(),
        "start_instance",
        json!({ "by_id": id }),
    )
    .await?;
    Ok(())
}

/// Whether an error is the indexer's transient "the validator committee / peer
/// address isn't resolvable yet" condition, as opposed to a genuine failure.
fn is_network_not_ready(message: &str) -> bool {
    message.contains("No committee VNs found")
        || message.contains("No addresses for peer")
        || message.contains("Network interface error")
        || message.contains("Epoch manager error")
}

/// Retry a fallible operation while it fails with a transient "network not
/// ready yet" error. Used after restarting the indexer to wait out the time it
/// takes to re-sync its epoch manager and populate its peer store, without
/// masking genuine failures.
async fn retry_until_network_ready<T, F, Fut>(
    timeout: Duration,
    interval: Duration,
    mut f: F,
) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    let start = tokio::time::Instant::now();
    let mut last_log = Duration::ZERO;
    loop {
        match f().await {
            Ok(value) => return Ok(value),
            Err(err) => {
                let message = err.to_string();
                if !is_network_not_ready(&message) {
                    return Err(err);
                }
                if tokio::time::Instant::now() >= deadline {
                    return Err(err);
                }
                let elapsed = tokio::time::Instant::now() - start;
                if elapsed.saturating_sub(last_log) >= Duration::from_secs(15) {
                    info!("swarm not ready yet; retrying ({message})");
                    last_log = elapsed;
                }
                tokio::time::sleep(interval).await;
            }
        }
    }
}

async fn wait_for_swarm(client: &Client) -> Result<()> {
    info!("waiting for swarm webserver at {}", swarm_url());
    poll_until(Duration::from_secs(120), Duration::from_secs(2), || async {
        match json_rpc(client, &swarm_url(), "ping", json!({})).await {
            Ok(body) => Ok(body["result"] == "pong"),
            Err(_) => Ok(false), // not up yet
        }
    })
    .await
}

async fn discover_ports(client: &Client) -> Result<(u16, String)> {
    // Returns `(walletd_jrpc_port, indexer_api_url)`. The swarm's process-manager
    // only starts answering `list_instances` once the base node is ready and
    // validators are registered, which can take several minutes on a cold start.
    info!("waiting for the swarm to finish booting (this can take several minutes)...");
    poll_for_value(Duration::from_secs(600), Duration::from_secs(2), || async {
        let body = json_rpc(
            client,
            &swarm_url(),
            "list_instances",
            json!({ "by_type": null }),
        )
        .await?;
        let instances = body["result"]["instances"]
            .as_array()
            .ok_or_else(|| anyhow!("no instances listed: {body}"))?;

        let mut walletd_port = None;
        let mut indexer_port = None;
        for inst in instances {
            match inst["instance_type"].as_str() {
                Some("TariWalletDaemon") => {
                    walletd_port = inst["ports"]["jrpc"].as_u64().map(|p| p as u16);
                    // Full instance info (id, ports, any address) helps debug a
                    // wallet daemon that the swarm lists but we can't reach.
                    info!("wallet daemon instance: {inst}");
                }
                Some("TariIndexer") => {
                    indexer_port = inst["ports"]["api"].as_u64().map(|p| p as u16);
                }
                _ => {}
            }
        }

        match (walletd_port, indexer_port) {
            (Some(w), Some(i)) => Ok((w, format!("http://127.0.0.1:{i}"))),
            _ => Err(anyhow!(
                "could not find wallet daemon/indexer ports in: {body}"
            )),
        }
    })
    .await
}

/// Obtain a JWT by logging in anonymously. `authentication = none` still
/// requires a bearer on every protected method; it only swaps WebAuthn for an
/// anonymous login (`auth.request` with `credentials: "None"`). The returned
/// JWT grants `Admin` and is used to mint the long-lived API key the webui and
/// the rest of this tool talk to the wallet daemon with.
async fn authenticate_walletd(client: &Client, walletd_url: &str) -> Result<String> {
    info!("authenticating to wallet daemon (auth mode: none)");
    let body = json_rpc(
        client,
        walletd_url,
        "auth.request",
        json!({ "permissions": ["Admin"], "credentials": "None" }),
    )
    .await?;
    body["result"]["token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow!("auth.request returned no token: {body}"))
}

/// Mint a long-lived API key (never expiring) with `Admin` scope. API keys can
/// only be minted from an interactive (JWT) session, not from another API key,
/// so this must be called with the JWT returned by [`authenticate_walletd`].
async fn mint_api_key(client: &Client, walletd_url: &str, jwt: &str) -> Result<String> {
    info!("minting wallet daemon API key");
    let body = json_rpc_bearer(
        client,
        walletd_url,
        "auth.create_api_key",
        json!({ "name": "localnet", "permissions": ["admin"], "confirm_admin": true }),
        Some(jwt),
    )
    .await?;
    body["result"]["api_key"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow!("auth.create_api_key returned no api_key: {body}"))
}

async fn wait_for_walletd(client: &Client, walletd_url: &str) -> Result<()> {
    info!("waiting for wallet daemon at {walletd_url}");
    // `wallet.get_info` is unauthenticated, unlike `accounts.*`; use it to probe
    // for readiness before we log in and mint the API key. Log the underlying
    // error (not just "still waiting") so a CI timeout tells us *why* the daemon
    // is unreachable (connection refused vs. HTTP auth vs. a JSON-RPC error).
    let deadline = tokio::time::Instant::now() + Duration::from_secs(240);
    let start = tokio::time::Instant::now();
    let mut last_log = Duration::ZERO;
    loop {
        match json_rpc(client, walletd_url, "wallet.get_info", json!({})).await {
            Ok(_) => return Ok(()),
            Err(err) => {
                if tokio::time::Instant::now() >= deadline {
                    bail!("wallet daemon not ready after 240s; last error: {err}");
                }
                let elapsed = tokio::time::Instant::now() - start;
                if elapsed.saturating_sub(last_log) >= Duration::from_secs(15) {
                    info!("wallet daemon not ready yet ({elapsed:?}): {err}");
                    last_log = elapsed;
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}

async fn fetch_account(
    client: &Client,
    walletd_url: &str,
    token: &str,
) -> Result<(String, String)> {
    let body = json_rpc_bearer(
        client,
        walletd_url,
        "accounts.get_default",
        json!({}),
        Some(token),
    )
    .await?;
    let pubkey = body["result"]["account"]["owner_public_key"]
        .as_str()
        .ok_or_else(|| anyhow!("no owner_public_key: {body}"))?
        .to_string();
    let component_address = body["result"]["account"]["component_address"]
        .as_str()
        .ok_or_else(|| anyhow!("no component_address: {body}"))?
        .to_string();
    Ok((pubkey, component_address))
}

/// Fund the default account from the testnet faucet. This both deposits 1000
/// TARI and — critically — creates the account component on-chain. Until the
/// account exists on-chain, `transactions.publish_template` cannot use it as a
/// `fee_account` and fails with "Substate … does not exist". The handler waits
/// for the faucet transaction to finalize before returning.
async fn fund_account(
    client: &Client,
    walletd_url: &str,
    component_address: &str,
    token: &str,
) -> Result<()> {
    info!("funding default account with free test coins");
    let body = json_rpc_with_timeout(
        client,
        walletd_url,
        "accounts.create_free_test_coins",
        json!({
            "account": { "ComponentAddress": component_address },
            "max_fee": 1_000_000,
        }),
        Some(token),
        Duration::from_secs(300),
    )
    .await?;
    let tx_id = body["result"]["transaction_id"].as_str().unwrap_or("?");
    info!("account funded (faucet transaction {tx_id})");
    Ok(())
}

async fn list_authored_templates(
    client: &Client,
    walletd_url: &str,
    pubkey: &str,
    token: &str,
) -> Result<Vec<String>> {
    let body = json_rpc_bearer(
        client,
        walletd_url,
        "templates.list_authored",
        json!({ "author_public_key": pubkey, "page": 0, "page_size": 100 }),
        Some(token),
    )
    .await?;
    let addrs = body["result"]["templates"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t["address"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(addrs)
}

async fn wait_for_transaction(
    client: &Client,
    walletd_url: &str,
    tx_id: &str,
    token: &str,
) -> Result<()> {
    info!("waiting for transaction {tx_id} to finalize");
    poll_until(Duration::from_secs(240), Duration::from_secs(2), || async {
        let body = json_rpc_bearer(
            client,
            walletd_url,
            "transactions.get_result",
            json!({ "transaction_id": tx_id }),
            Some(token),
        )
        .await?;
        let status = body["result"]["status"].as_str().unwrap_or("");
        match status {
            "Accepted" => Ok(true),
            "Rejected" | "InvalidTransaction" | "DryRunFailed" | "OnlyFeeAccepted" => {
                bail!("transaction {tx_id} ended with status '{status}': {body}")
            }
            _ => Ok(false),
        }
    })
    .await
}

async fn publish_template(
    client: &Client,
    walletd_url: &str,
    paths: &Paths,
    component_address: &str,
    pubkey: &str,
    token: &str,
) -> Result<String> {
    let wasm = std::fs::read(&paths.wasm)?;
    let binary = base64::engine::general_purpose::STANDARD.encode(&wasm);

    // 1. Dry-run to get an accurate fee estimate.
    info!("estimating publish fee (dry run)");
    let fee_body = json_rpc_bearer(
        client,
        walletd_url,
        "transactions.publish_template",
        json!({
            "binary": binary,
            "fee_account": { "ComponentAddress": component_address },
            "max_fee": 1_000_000,
            "detect_inputs": true,
            "dry_run": true,
        }),
        Some(token),
    )
    .await?;
    let fee = fee_body["result"]["dry_run_fee"]
        .as_u64()
        .ok_or_else(|| anyhow!("dry run returned no fee estimate: {fee_body}"))?;
    info!("estimated publish fee: {fee}");

    let max_fee = fee.saturating_mul(2).saturating_add(5000).max(250_000);
    info!("publishing with max_fee={max_fee}");

    // 2. Snapshot authored templates so we can find the newly published one.
    let before = list_authored_templates(client, walletd_url, pubkey, token).await?;

    // 3. Real publish.
    let publish_body = json_rpc_bearer(
        client,
        walletd_url,
        "transactions.publish_template",
        json!({
            "binary": binary,
            "fee_account": { "ComponentAddress": component_address },
            "max_fee": max_fee,
            "detect_inputs": true,
            "dry_run": false,
        }),
        Some(token),
    )
    .await?;
    let tx_id = publish_body["result"]["transaction_id"]
        .as_str()
        .ok_or_else(|| anyhow!("publish returned no transaction_id: {publish_body}"))?
        .to_string();

    wait_for_transaction(client, walletd_url, &tx_id, token).await?;

    // 4. Find the newly authored template address.
    let after = list_authored_templates(client, walletd_url, pubkey, token).await?;
    let new_addr = after
        .iter()
        .find(|a| !before.contains(a))
        .ok_or_else(|| anyhow!("could not determine the published template address"))?;

    if new_addr.starts_with("template_") {
        Ok(new_addr.clone())
    } else {
        Ok(format!("template_{new_addr}"))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config output
// ─────────────────────────────────────────────────────────────────────────────
fn write_config(paths: &Paths, setup: &Setup) -> Result<()> {
    info!("writing .env.local");
    let api_key_line = match &setup.api_key {
        Some(key) => format!("VITE_WALLETD_API_KEY={key}\n"),
        None => String::new(),
    };
    // `VITE_WALLETD_TARGET` is the Vite dev-server proxy target for `/walletd`.
    // It must be `localhost`, not `127.0.0.1`: on macOS `localhost` resolves to
    // `::1` first and the wallet daemon binds there, so proxying to the IPv4
    // literal yields HTTP 502.
    let indexer_url = &setup.indexer_url;
    let walletd_port = setup.walletd_port;
    let template_addr = &setup.template_addr;
    let env = format!(
        "VITE_NETWORK=LocalNet\n\
         VITE_INDEXER_URL={indexer_url}\n\
         VITE_WALLETD_TARGET=http://localhost:{walletd_port}\n\
         {api_key_line}\
         VITE_TEMPLATE_ADDRESS={template_addr}\n"
    );
    std::fs::write(&paths.env_local, env)?;

    info!("writing cypress/fixtures/localnet.json");
    std::fs::create_dir_all(&paths.fixtures_dir)?;
    let fixture = json!({
        "accountPublicKey": setup.pubkey,
        "templateAddress": setup.template_addr,
    });
    std::fs::write(&paths.fixture, serde_json::to_string_pretty(&fixture)?)?;

    info!("config written");
    Ok(())
}
