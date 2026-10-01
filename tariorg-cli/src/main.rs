#![feature(float_conversions)]
mod e2e_infra;
mod want_list;

use crate::want_list::WantList;
use clap::{CommandFactory, Parser, Subcommand};
use dialoguer::{Input, Select};
use ootle_rs::{
    Address, Epoch, Network, ToAccountAddress, TransactionRequest,
    builtin_templates::{UnsignedTransactionBuilder, faucet::IFaucet},
    crypto::StealthCryptoApi,
    key_provider::PrivateKeyProvider,
    keys::OotleSecretKey,
    provider::{IndexerProvider, Provider, ProviderBuilder, WalletProvider},
    stealth::StealthTransfer,
    wallet::{NetworkWallet, OotleWallet},
};
use random_name::generate_name;
use std::path::{Path, PathBuf};
use tari_bor::{CborLen, Decode, Encode, minicbor};
use tari_crypto::ristretto::{RistrettoPublicKey, RistrettoSecretKey};
use tari_indexer_client::types::ListUtxosRequest;
use tari_ootle_common_types::displayable::Displayable;
use tari_ootle_common_types::engine_types::transaction_receipt::TransactionReceipt;
use tari_ootle_transaction::{Transaction, TransactionBuilder, args};
use tari_template_lib::macros::rust::collections::{HashMap, HashSet};
use tari_template_lib::models::Vault;
use tari_template_lib_types::{
    Amount, ComponentAddress, ResourceAddress, TemplateAddress, UtxoAddress, UtxoId,
    constants::TARI_TOKEN,
    crypto::{PedersenCommitmentBytes, RistrettoPublicKeyBytes},
};
use tari_utilities::{ByteArray, hex::Hex};
use tariorg_types::{Proposal, ProposalAction, Send};

#[derive(Encode, Decode, Debug, CborLen, Clone)]
pub struct Organization {
    #[n(0)]
    pub members: HashSet<RistrettoPublicKeyBytes>,
    #[n(1)]
    pub vaults: HashMap<ResourceAddress, Vault>,
    #[n(2)]
    pub threshold_ratio: f64,
    #[n(3)]
    pub proposals: HashMap<u64, Proposal>,
    #[n(4)]
    pub next_proposal_id: u64,
}

#[derive(Parser)]
#[command(
    name = "tariorg-cli",
    about = "🎮 A CLI for the Tari Organizations",
    long_about = "This CLI allows you to interact with an Organization template on the Tari network.\n\n\
                  The flow is as follows:\n\
                  1. Run `init` to set up your admin wallet and create users accounts.\n\
                  2. Run `create` to deploy a new Organization component instance.\n\
                  3. Run `propose` to create a proposal.\n\
                  4. Members use `vote` to vote on proposal.\n\
                  5. Run `execute` to execute a passed proposals."
)]
struct Cli {
    /// Path to JSON state file
    #[arg(long, default_value = "./state.json")]
    state: PathBuf,

    /// Indexer REST API URL (overrides value stored in state)
    #[arg(long)]
    indexer: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize wallet, create account, and fund via faucet
    Init,
    /// Deploy a new Organization component using the template address and members addresses from state
    Create,
    /// Create a proposal to add a new member to the Organization
    ProposeAddMember { member: String },
    /// Create a proposal to remove an existing member from the Organization
    ProposeRemoveMember { member: String },
    /// Create a proposal to send some resources
    ProposeSend {
        recipient: ComponentAddress,
        amount: Amount,
        resource: ResourceAddress,
    },
    // TODO: support Invoke proposals
    /// Vote on a proposal
    Vote {
        proposal_id: u64,
        #[arg(action = clap::ArgAction::Set)]
        support: bool,
    },
    /// Execute a proposal
    Execute { proposal_id: u64 },
    /// Show details about user by name
    UserInfo,
    /// Show details about the state
    Show,
    /// Print the deployer account's Ootle address (to fund it with tTARI)
    Address,
    /// Create a new user
    AddUser,
    /// Deposit an user's tTaris into the organization, TODO: support depositing any resource
    Deposit { amount: f64 },
    /// Reveal a confidential (stealth) TARI balance back into the deployer account's visible vault
    Reveal {
        /// Pedersen commitment (32-byte hex) of the stealth UTXO to reveal. When omitted, all
        /// stealth UTXOs owned by the account's view key are discovered and revealed.
        #[arg(long)]
        commitment: Option<String>,
    },
    /// Deploy the demo faucet (publish template + create + fund) and save its address
    DeployFaucet {
        /// Path to the faucet WASM
        #[arg(
            long,
            default_value = "target/wasm32-unknown-unknown/release/faucet.wasm"
        )]
        wasm: PathBuf,
        /// Initial funding, in whole TARI (the faucet gives 1 TARI per claim)
        #[arg(long, default_value_t = 5_000)]
        amount: u64,
    },
    /// Set up or tear down the localnet infrastructure used by the webui e2e tests
    E2eInfra(e2e_infra::E2eInfraArgs),
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct User {
    name: String,
    account_secret_hex: String,
    view_secret_hex: String,
    /// On-chain account component address, stored as "component_<hex>"
    account_address: ComponentAddress,
}

impl User {
    fn to_wallet(&self, network: Network) -> OotleWallet {
        let acc_bytes =
            Vec::from_hex(&self.account_secret_hex).expect("Invalid account secret hex");
        let view_bytes = Vec::from_hex(&self.view_secret_hex).expect("Invalid view secret hex");
        let acc_sk = RistrettoSecretKey::from_canonical_bytes(&acc_bytes)
            .expect("Invalid account key bytes");
        let view_sk =
            RistrettoSecretKey::from_canonical_bytes(&view_bytes).expect("Invalid view key bytes");
        let secret = OotleSecretKey::new(network, acc_sk, view_sk);
        OotleWallet::from(PrivateKeyProvider::new(secret))
    }
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct State {
    account_secret_hex: Option<String>,
    view_secret_hex: Option<String>,
    #[serde(default = "default_network")]
    network: String,
    #[serde(default = "default_indexer_url")]
    indexer_url: String,
    /// On-chain account component address, stored as "component_<hex>"
    account_address: Option<ComponentAddress>,
    /// Stored as "template_<hex>" string
    template_address: Option<String>,
    /// Organization component address, stored as "component_<hex>"
    component_address: Option<ComponentAddress>,
    /// Faucet component address, stored as "component_<hex>"
    #[serde(default)]
    faucet_address: Option<ComponentAddress>,
    #[serde(default)]
    users: Vec<User>,
}

fn default_network() -> String {
    "Esmeralda".to_string()
}
fn default_indexer_url() -> String {
    "http://127.0.0.1:12500".to_string()
}

fn default_indexer_url_for_network(network: &str) -> &'static str {
    match network {
        "Esmeralda" => "https://ootle-indexer-a.tari.com/",
        _ => "http://127.0.0.1:12500",
    }
}

impl State {
    fn is_initialized(&self) -> bool {
        self.account_secret_hex.is_some() && self.view_secret_hex.is_some()
    }
}

fn load_state(path: &Path) -> anyhow::Result<State> {
    if path.exists() {
        let s = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&s)?)
    } else {
        Ok(State::default())
    }
}

fn save_state(path: &Path, state: &State) -> anyhow::Result<()> {
    let s = serde_json::to_string_pretty(state)?;
    std::fs::write(path, s)?;
    Ok(())
}

fn parse_stored_template_address(s: &str) -> anyhow::Result<TemplateAddress> {
    use std::str::FromStr;
    let hex = s.strip_prefix("template_").unwrap_or(s);
    TemplateAddress::from_str(hex).map_err(|e| anyhow::anyhow!("Invalid template address: {e}"))
}

fn parse_network(s: &str) -> anyhow::Result<Network> {
    match s {
        "LocalNet" => Ok(Network::LocalNet),
        "Esmeralda" => Ok(Network::Esmeralda),
        "Igor" => Ok(Network::Igor),
        "MainNet" => anyhow::bail!("MainNet is not supported in this example."),
        other => anyhow::bail!("Unknown network: {other}"),
    }
}

fn parse_public_key(s: &str) -> anyhow::Result<RistrettoPublicKeyBytes> {
    s.parse()
        .map_err(|e| anyhow::anyhow!("Invalid public key {s:?}: {e}"))
}

fn wallet_from_state(state: &State) -> anyhow::Result<OotleWallet> {
    let network = parse_network(&state.network)?;
    let acc_bytes = Vec::from_hex(state.account_secret_hex.as_deref().unwrap_or(""))
        .map_err(|e| anyhow::anyhow!("Invalid account secret hex: {e}"))?;
    let view_bytes = Vec::from_hex(state.view_secret_hex.as_deref().unwrap_or(""))
        .map_err(|e| anyhow::anyhow!("Invalid view secret hex: {e}"))?;
    let acc_sk = RistrettoSecretKey::from_canonical_bytes(&acc_bytes)
        .map_err(|e| anyhow::anyhow!("Invalid account key: {e}"))?;
    let view_sk = RistrettoSecretKey::from_canonical_bytes(&view_bytes)
        .map_err(|e| anyhow::anyhow!("Invalid view key: {e}"))?;
    let secret = OotleSecretKey::new(network, acc_sk, view_sk);
    Ok(OotleWallet::from(PrivateKeyProvider::new(secret)))
}

/// How many epochs ahead of the current one a transaction we build stays valid for. Every
/// transaction declares the last epoch it may be sequenced in; past it, it can never land.
const MAX_EPOCH_WINDOW: u64 = 10;

/// Revealed µTARI reserved in the fee intent to pay a reveal transaction's fee. A stealth-revealed
/// fee is not refundable, so this is deliberately small: a single-input reveal costs far less than
/// this, and the overcharge is kept by validators rather than returned.
const REVEAL_FEE_BUDGET: u64 = 250_000;

async fn max_epoch(provider: &IndexerProvider<OotleWallet>) -> anyhow::Result<Epoch> {
    let current = provider.get_epoch().await?;
    Ok(Epoch(current.as_u64() + MAX_EPOCH_WINDOW))
}

async fn build_and_send(
    provider: &mut IndexerProvider<OotleWallet>,
    build_fn: impl FnOnce(TransactionBuilder) -> TransactionBuilder,
    want_list: WantList,
) -> anyhow::Result<TransactionReceipt> {
    let network = provider.network();

    let max_epoch = max_epoch(provider).await?;

    let base_builder = TransactionBuilder::new(network, max_epoch).with_auto_fill_inputs();
    let unsigned_tx = build_fn(base_builder).build_unsigned();
    let unsigned_tx = provider
        .resolve_input_want_list(unsigned_tx, want_list.items())
        .await?;

    let tx = TransactionRequest::default()
        .with_transaction(unsigned_tx)
        .build(provider.wallet())
        .await?;

    let pending = provider.send_transaction(tx).await?;
    println!("⏳ Transaction submitted: {}", pending.tx_id());
    let outcome = pending.watch().await?;
    println!("🏁 Outcome: {outcome}");

    if let Some(reason) = outcome.reject_reason() {
        anyhow::bail!("❌ Transaction rejected: {reason}");
    }
    let receipt = pending.get_receipt().await?;
    Ok(receipt)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let state_path = cli.state;
    let mut state = load_state(&state_path)?;

    // Allow --indexer flag to override stored value
    if let Some(url) = cli.indexer {
        state.indexer_url = url;
    }

    match cli.command {
        Commands::Init => cmd_init(&state_path, &mut state).await?,
        Commands::Create => cmd_create(&state_path, &mut state).await?,
        Commands::Show => cmd_show(&state).await?,
        Commands::Address => cmd_address(&state)?,
        Commands::AddUser => cmd_add_user(&state_path, &mut state).await?,
        Commands::ProposeAddMember { member } => {
            let id = parse_public_key(&member)?;
            cmd_propose(&mut state, ProposalAction::AddMember(id)).await?
        }
        Commands::ProposeRemoveMember { member } => {
            let id = parse_public_key(&member)?;
            cmd_propose(&mut state, ProposalAction::RemoveMember(id)).await?
        }
        Commands::Vote {
            proposal_id,
            support,
        } => cmd_vote(&mut state, proposal_id, support).await?,
        Commands::UserInfo => {
            cmd_user_info(&mut state).await?;
        }
        Commands::Execute { proposal_id } => cmd_execute(&mut state, proposal_id).await?,
        Commands::Deposit { amount } => cmd_deposit(&mut state, amount).await?,
        Commands::Reveal { commitment } => cmd_reveal(&state, commitment).await?,
        Commands::DeployFaucet { wasm, amount } => {
            cmd_deploy_faucet(&state_path, &mut state, wasm, amount).await?
        }
        Commands::E2eInfra(args) => e2e_infra::run(args).await?,
        Commands::ProposeSend {
            recipient,
            amount,
            resource,
        } => {
            cmd_propose(
                &mut state,
                ProposalAction::Send(Send {
                    recipient,
                    amount,
                    resource,
                }),
            )
            .await?
        }
    }

    Ok(())
}

async fn cmd_init(state_path: &Path, state: &mut State) -> anyhow::Result<()> {
    // If fully complete, just show current state.
    if state.is_initialized() && state.account_address.is_some() {
        println!("✅ Cli is already initialized.");
        println!("  🌐 Network:          {}", state.network);
        println!("  🔗 Indexer:          {}", state.indexer_url);
        println!(
            "  🏦 Account address:  {}",
            state.account_address.as_ref().display()
        );
        println!(
            "  📄 Template address: {}",
            state
                .template_address
                .as_deref()
                .unwrap_or("(not set — run `create`)")
        );
        println!(
            "  🎮 Organization component:   {}",
            state
                .component_address
                .as_ref()
                .map(|a| a.to_string())
                .unwrap_or_else(|| "(not set — run `create`)".to_string())
        );
        println!();
        Cli::command().print_help()?;
        println!();
        return Ok(());
    }

    // ── Interactive prompts (skipped if keys already exist) ──────────────────

    if !state.is_initialized() {
        let networks = &["Esmeralda", "LocalNet"];
        let network_idx = Select::new()
            .with_prompt("Select network")
            .default(0)
            .items(networks)
            .interact()?;
        let network_str = networks[network_idx];
        let network = parse_network(network_str)?;

        let indexer_url: String = Input::new()
            .with_prompt("Indexer REST API URL")
            .default(default_indexer_url_for_network(network_str).to_string())
            .interact_text()?;

        let template_input: String = Input::new()
            .with_prompt("Organization template address (leave blank to set later)")
            .allow_empty(true)
            .interact_text()?;
        let template_address = if template_input.trim().is_empty() {
            None
        } else {
            let addr = parse_stored_template_address(template_input.trim())?;
            Some(format!("template_{addr}"))
        };

        let secret = OotleSecretKey::random(network);
        state.account_secret_hex = Some(secret.account_secret().to_hex());
        state.view_secret_hex = Some(secret.view_only_secret().to_hex());
        state.network = network_str.to_string();
        state.indexer_url = indexer_url;
        state.template_address = template_address;

        // Save early so key material is not lost if the next step fails
        save_state(state_path, state)?;
    } else {
        println!("🔑 Keys found. Retrying account creation and funding...");
    }

    // ── Account creation and funding ─────────────────────────────────────────

    let wallet = wallet_from_state(state)?;
    let indexer_url = state.indexer_url.clone();

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let account_addr = provider.default_signer_address().to_account_address();

    println!("🚰 Creating account and funding via faucet...");
    println!(
        "  📬 OotleAddress (share this to receive funds): {}",
        provider.default_signer_address()
    );
    println!("  🏦 Account component: {account_addr}");

    let unsigned_tx = IFaucet::new(&provider, max_epoch(&provider).await?)
        .take_faucet_funds()
        .pay_fee(4000u64)
        .prepare()
        .await?;

    let tx = TransactionRequest::default()
        .with_transaction(unsigned_tx)
        .build(provider.wallet())
        .await?;

    let pending = provider.send_transaction(tx).await?;
    println!("⏳ Transaction submitted: {}", pending.tx_id());
    let outcome = pending.watch().await?;
    println!("🏁 Outcome: {outcome}");

    if let Some(reason) = outcome.reject_reason() {
        anyhow::bail!("❌ Transaction rejected: {reason}");
    }
    println!("💰 Account funded successfully.");

    state.account_address = Some(account_addr);
    save_state(state_path, state)?;

    // ── Create users ───────────────────────────────────────────────────────

    let num_users: u64 = Input::new()
        .with_prompt("How many users to create?")
        .default(5)
        .interact_text()?;

    drop(provider); // release the connection before creating users

    println!("👥 Creating {num_users} user(s)...");
    // TODO: do this in one transaction
    for _ in 0..num_users {
        create_user(state_path, state, None).await?;
    }

    println!();
    println!("🎉 Initialization complete!");
    println!(
        "  📬 OotleAddress:     {}",
        state.account_address.as_ref().display()
    );
    println!("  🏦 Account address:  {account_addr}");
    println!("  👥 Users created:  {}", state.users.len());
    println!();
    println!("👉 Next step: run `create` to deploy the component.");

    Ok(())
}

async fn cmd_create(state_path: &Path, state: &mut State) -> anyhow::Result<()> {
    let _network = parse_network(&state.network)?;
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }

    let template_addr =
        parse_stored_template_address(state.template_address.as_deref().ok_or_else(|| {
            anyhow::anyhow!(
                "No template address in state. Set one during `init` or update the state file."
            )
        })?)?;
    let wallet = wallet_from_state(state)?;
    let indexer_url = state.indexer_url.clone();

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let account_addr = provider.default_signer_address().to_account_address();

    let want_list = WantList::new().add_vault_for_resource(account_addr, TARI_TOKEN, true);

    println!("🚀 Creating a new Organization component...");
    let threshold: f64 = 0.6;

    let mut initial_members = HashSet::new();
    initial_members.insert(*provider.default_signer_address().account_public_key());

    let receipt = build_and_send(
        &mut provider,
        |builder| {
            builder
                .pay_fee_from_component(account_addr, 2000u64)
                .call_function(template_addr, "new", args![initial_members, threshold])
        },
        want_list,
    )
    .await?;

    let component_addr = receipt
        .diff_summary
        .upped
        .iter()
        .find_map(|s| s.substate_id.as_component_address())
        .ok_or_else(|| anyhow::anyhow!("No component address in receipt"))?;

    println!(
        "🚀 Organization created: {component_addr} (saved to {})",
        state_path.display()
    );

    state.component_address = Some(component_addr);

    save_state(state_path, state)?;

    Ok(())
}

async fn cmd_deploy_faucet(
    state_path: &Path,
    state: &mut State,
    wasm_path: PathBuf,
    amount_tari: u64,
) -> anyhow::Result<()> {
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }

    let wallet = wallet_from_state(state)?;
    let indexer_url = state.indexer_url.clone();

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let account_addr = provider.default_signer_address().to_account_address();
    let wasm = std::fs::read(&wasm_path)?;

    // 1. Publish the faucet template.
    println!("📤 Publishing faucet template...");
    let receipt = build_and_send(
        &mut provider,
        |builder| {
            builder
                .pay_fee_from_component(account_addr, 1_000_000u64)
                .publish_template(wasm)
        },
        WantList::new().add_vault_for_resource(account_addr, TARI_TOKEN, true),
    )
    .await?;

    let template_addr = receipt
        .diff_summary
        .upped
        .iter()
        .find_map(|s| s.substate_id.as_template().map(|t| t.as_template_address()))
        .ok_or_else(|| anyhow::anyhow!("No template address in publish receipt"))?;
    println!("📄 Faucet template address: {template_addr}");

    // 2. Create and fund the faucet.
    let funding = Amount::from(amount_tari * 1_000_000u64);
    println!("🚰 Creating faucet funded with {amount_tari} TARI...");
    let receipt = build_and_send(
        &mut provider,
        |builder| {
            builder
                .pay_fee_from_component(account_addr, 10_000u64)
                .call_method(account_addr, "withdraw", args![TARI_TOKEN, funding])
                .put_last_instruction_output_on_workspace("bucket")
                .call_function(template_addr, "new", args![Workspace("bucket")])
        },
        WantList::new().add_vault_for_resource(account_addr, TARI_TOKEN, true),
    )
    .await?;

    let faucet_addr = receipt
        .diff_summary
        .upped
        .iter()
        .find_map(|s| s.substate_id.as_component_address())
        .ok_or_else(|| anyhow::anyhow!("No component address in receipt"))?;

    println!(
        "🎉 Faucet component: {faucet_addr} (saved to {})",
        state_path.display()
    );
    state.faucet_address = Some(faucet_addr);
    save_state(state_path, state)?;

    Ok(())
}

async fn cmd_propose(state: &mut State, action: ProposalAction) -> anyhow::Result<()> {
    let network = parse_network(&state.network)?;
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }

    let component_addr = state
        .component_address
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("No component address in state. Run `create` first."))?;

    // Ask which user is proposing
    let user_names: Vec<String> = state.users.iter().map(|u| u.name.to_string()).collect();
    let user_idx = Select::new()
        .with_prompt("Select user proposing")
        .default(0)
        .items(&user_names)
        .interact()?;
    let user = &state.users[user_idx];

    let wallet = user.to_wallet(network);
    let indexer_url = state.indexer_url.clone();

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let account_addr = provider.default_signer_address().to_account_address();

    let want_list = WantList::new().add_vault_for_resource(account_addr, TARI_TOKEN, true);

    println!("Proposing {:?}", action);
    let receipt = build_and_send(
        &mut provider,
        |builder| {
            builder
                .pay_fee_from_component(account_addr, 4000u64)
                .call_method(*component_addr, "propose", args![action])
        },
        want_list,
    )
    .await?;

    println!("{:?}", receipt);

    println!("👉 Proposal created but not sure of id yet");

    Ok(())
}

async fn cmd_vote(state: &mut State, proposal_id: u64, support: bool) -> anyhow::Result<()> {
    let network = parse_network(&state.network)?;
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }

    let component_addr = state
        .component_address
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("No component address in state. Run `create` first."))?;

    // Ask which user is proposing
    let user_names: Vec<String> = state.users.iter().map(|u| u.name.to_string()).collect();
    let user_idx = Select::new()
        .with_prompt("Select user voting")
        .default(0)
        .items(&user_names)
        .interact()?;
    let user = &state.users[user_idx];

    let wallet = user.to_wallet(network);
    let indexer_url = state.indexer_url.clone();

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let account_addr = provider.default_signer_address().to_account_address();

    let want_list = WantList::new().add_vault_for_resource(account_addr, TARI_TOKEN, true);

    println!("Voting {} on proposal {}", support, proposal_id);
    let receipt = build_and_send(
        &mut provider,
        |builder| {
            builder
                .pay_fee_from_component(account_addr, 4000u64)
                .call_method(*component_addr, "vote", args![proposal_id, support])
        },
        want_list,
    )
    .await?;

    println!("{:?}", receipt);

    println!("👉 Proposal created but not sure of id yet");

    Ok(())
}

async fn cmd_execute(state: &mut State, proposal_id: u64) -> anyhow::Result<()> {
    let network = parse_network(&state.network)?;
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }

    let component_addr = state
        .component_address
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("No component address in state. Run `create` first."))?;

    // Ask which user is proposing
    let user_names: Vec<String> = state.users.iter().map(|u| u.name.to_string()).collect();
    let user_idx = Select::new()
        .with_prompt("Select user executing")
        .default(0)
        .items(&user_names)
        .interact()?;
    let user = &state.users[user_idx];

    let wallet = user.to_wallet(network);
    let indexer_url = state.indexer_url.clone();

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let account_addr = provider.default_signer_address().to_account_address();

    let mut want_list = WantList::new().add_vault_for_resource(account_addr, TARI_TOKEN, true);

    let substate = provider.get_substate(*component_addr).await?.unwrap();

    let org: Organization = substate
        .into_substate_value()
        .into_component()
        .unwrap()
        .body()
        .state
        .decoded()
        .unwrap();

    let proposal = org.proposals.get(&proposal_id).unwrap();

    if let ProposalAction::Send(Send {
        recipient,
        resource,
        amount: _,
    }) = proposal.action
    {
        want_list = want_list
            .add_specific_substate(recipient, true)
            .add_vault_for_resource(*component_addr, resource, true)
            .add_vault_for_resource(recipient, resource, true);
    }

    println!("Executing proposal {}", proposal_id);
    let receipt = build_and_send(
        &mut provider,
        |builder| {
            builder
                .pay_fee_from_component(account_addr, 4000u64)
                .call_method(*component_addr, "execute", args![proposal_id])
        },
        want_list,
    )
    .await?;

    println!("{:?}", receipt);

    println!("👉 Proposal created but not sure of id yet");

    Ok(())
}

async fn cmd_deposit(state: &mut State, amount: f64) -> anyhow::Result<()> {
    let network = parse_network(&state.network)?;
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }

    let component_addr = state
        .component_address
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("No component address in state. Run `create` first."))?;

    // Ask which user is proposing
    let user_names: Vec<String> = state.users.iter().map(|u| u.name.to_string()).collect();
    let user_idx = Select::new()
        .with_prompt("Select user depositing")
        .default(0)
        .items(&user_names)
        .interact()?;
    let user = &state.users[user_idx];

    let wallet = user.to_wallet(network);
    let indexer_url = state.indexer_url.clone();

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let account_addr = provider.default_signer_address().to_account_address();

    let want_list = WantList::new()
        .add_vault_for_resource(account_addr, TARI_TOKEN, true)
        .add_vault_for_resource(*component_addr, TARI_TOKEN, false);

    let res = provider.get_resource(TARI_TOKEN).await?;

    println!(
        "Funding organization: {} {}",
        amount,
        res.metadata()
            .get("SYMBOL")
            .unwrap()
            .decode::<String>()
            .unwrap(),
    );
    let receipt = build_and_send(
        &mut provider,
        |builder| {
            builder
                .pay_fee_from_component(account_addr, 4000u64)
                .call_method(
                    account_addr,
                    "withdraw",
                    args![
                        TARI_TOKEN,
                        &Amount::from_u64(
                            (amount * f64::from(10u32.pow(u32::from(res.divisibility()))))
                                .to_int_checked()
                                .unwrap()
                        )
                    ],
                )
                .put_last_instruction_output_on_workspace("bucket")
                .call_method(*component_addr, "deposit", args![Workspace("bucket")])
        },
        want_list,
    )
    .await?;

    println!("{:?}", receipt);

    println!("👉 Proposal created but not sure of id yet");

    Ok(())
}

async fn cmd_user_info(state: &mut State) -> anyhow::Result<()> {
    let network = parse_network(&state.network)?;
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }

    if state.users.is_empty() {
        anyhow::bail!("No users found in state.");
    }

    let user_names: Vec<String> = state.users.iter().map(|u| u.name.to_string()).collect();
    let user_idx = Select::new()
        .with_prompt("Select user")
        .default(0)
        .items(&user_names)
        .interact()?;
    let user = &state.users[user_idx];

    let wallet = user.to_wallet(network);
    let indexer_url = state.indexer_url.clone();

    let provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let account_public_key = provider.default_signer_address().account_public_key();

    println!("Public key: {}", account_public_key);

    Ok(())
}

async fn cmd_add_user(state_path: &Path, state: &mut State) -> anyhow::Result<()> {
    create_user(state_path, state, None).await
}

async fn create_user(
    state_path: &Path,
    state: &mut State,
    name_arg: Option<String>,
) -> anyhow::Result<()> {
    let name = name_arg.unwrap_or_else(generate_name);
    let network = parse_network(&state.network)?;
    let secret = OotleSecretKey::random(network);
    let wallet = OotleWallet::from(PrivateKeyProvider::new(secret.clone()));

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&state.indexer_url)
        .await?;

    let address = secret.to_address();

    let account_address = address.to_account_address();

    println!("👤 Creating user '{name}' with account address {account_address}...");

    let unsigned_tx = IFaucet::new(&provider, max_epoch(&provider).await?)
        .take_faucet_funds()
        .pay_fee(4000u64)
        .prepare()
        .await?;
    let tx = TransactionRequest::default()
        .with_transaction(unsigned_tx)
        .build(provider.wallet())
        .await?;

    let pending = provider.send_transaction(tx).await?;
    println!("⏳ Transaction submitted: {}", pending.tx_id());
    let outcome = pending.watch().await?;
    println!("🏁 Outcome: {outcome}");

    if let Some(reason) = outcome.reject_reason() {
        anyhow::bail!("❌ Transaction rejected: {reason}");
    }
    println!("🚀 New user account created successfully.");

    let user = User {
        name,
        // WARNING: storing key material in state file is not secure! Don't do this. This is just for demo purposes.
        account_secret_hex: secret.account_secret().to_hex(),
        view_secret_hex: secret.view_only_secret().to_hex(),
        account_address,
    };

    println!("👤 Created user: {}", user.name);
    state.users.push(user);
    save_state(state_path, state)?;
    Ok(())
}

/// Print the deployer account's Ootle address so it can be funded: send tTARI
/// to this address from wherever you hold testnet funds, then run
/// `deploy-faucet`.
fn cmd_address(state: &State) -> anyhow::Result<()> {
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }
    let wallet = wallet_from_state(state)?;
    println!(
        "📬 Ootle address (send tTARI here to fund this account): {}",
        wallet.default_address()
    );
    Ok(())
}

fn view_secret_from_state(state: &State) -> anyhow::Result<RistrettoSecretKey> {
    let view_bytes = Vec::from_hex(state.view_secret_hex.as_deref().unwrap_or(""))
        .map_err(|e| anyhow::anyhow!("Invalid view secret hex: {e}"))?;
    RistrettoSecretKey::from_canonical_bytes(&view_bytes)
        .map_err(|e| anyhow::anyhow!("Invalid view key: {e}"))
}

fn parse_commitment(s: &str) -> anyhow::Result<PedersenCommitmentBytes> {
    PedersenCommitmentBytes::from_hex(s)
        .map_err(|e| anyhow::anyhow!("Invalid commitment hex {s:?}: {e}"))
}

async fn cmd_reveal(state: &State, commitment: Option<String>) -> anyhow::Result<()> {
    if !state.is_initialized() {
        anyhow::bail!("Wallet not initialized. Run `init` first.");
    }

    let network = parse_network(&state.network)?;
    let wallet = wallet_from_state(state)?;
    let view_secret = view_secret_from_state(state)?;
    let indexer_url = state.indexer_url.clone();

    let mut provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&indexer_url)
        .await?;

    let owner_addr = provider.default_signer_address().clone();
    let account_addr = owner_addr.to_account_address();

    let commitments = if let Some(c) = commitment {
        vec![parse_commitment(&c)?]
    } else {
        discover_owned_stealth_utxos(&indexer_url, &view_secret)
            .await?
            .into_iter()
            .map(|(c, _)| c)
            .collect()
    };

    if commitments.is_empty() {
        println!("🔍 No owned stealth TARI UTXOs found.");
        return Ok(());
    }

    for commitment in commitments {
        reveal_one(
            &mut provider,
            &owner_addr,
            account_addr,
            &view_secret,
            network,
            commitment,
        )
        .await?;
    }

    println!("✅ Reveal complete. Run `show` to confirm the account balance.");
    Ok(())
}

/// Enumerate the currently-unspent TARI stealth UTXOs and return the ones this wallet's view key
/// can decrypt, as `(commitment, value_µTARI)` pairs. Decrypting each output's AEAD ciphertext is
/// the ownership test, so this works whether or not the sender stamped a tag on the output.
async fn discover_owned_stealth_utxos(
    indexer_url: &str,
    view_secret: &RistrettoSecretKey,
) -> anyhow::Result<Vec<(PedersenCommitmentBytes, u64)>> {
    let client = tari_indexer_client::connect_rest(indexer_url)?;
    let crypto = StealthCryptoApi::new();
    let mut owned = Vec::new();

    // Paginate through the indexer's UTXO list (`from_id` is an exclusive cursor, keyed by UtxoId).
    let mut from_id: Option<UtxoId> = None;
    loop {
        let resp = client
            .list_utxos(ListUtxosRequest {
                resource_address: TARI_TOKEN,
                limit: 1000,
                from_id,
            })
            .await?;
        if resp.utxos.is_empty() {
            break;
        }
        for (utxo_id, utxo) in resp.utxos {
            from_id = Some(utxo_id);
            let Some(output) = utxo.output() else {
                continue;
            };
            let body = output.output();
            let nonce = RistrettoPublicKey::from_canonical_bytes(body.public_nonce.as_bytes())
                .map_err(|e| anyhow::anyhow!("Invalid stealth output public nonce: {e}"))?;
            let commitment = utxo_id.into_commitment_bytes();
            // Decryption succeeding is what proves the output belongs to this view key.
            if let Ok(decrypted) = crypto.decrypt_utxo_data(
                &body.encrypted_data,
                &commitment,
                view_secret,
                &nonce,
                true,
            ) {
                owned.push((commitment, decrypted.value()));
            }
        }
    }

    Ok(owned)
}

/// Reveal one stealth UTXO: spend it and turn its value into a visible account balance, revealing
/// a small slice to pay the transaction fee.
async fn reveal_one(
    provider: &mut IndexerProvider<OotleWallet>,
    owner_addr: &Address,
    account_addr: ComponentAddress,
    view_secret: &RistrettoSecretKey,
    network: Network,
    commitment: PedersenCommitmentBytes,
) -> anyhow::Result<()> {
    let utxo_addr = UtxoAddress::new(TARI_TOKEN, UtxoId::from(commitment));
    let substate = provider.fetch_substate(utxo_addr.clone()).await?;
    let utxo = substate
        .substate_value()
        .as_utxo()
        .ok_or_else(|| anyhow::anyhow!("Substate at {utxo_addr} is not a UTXO"))?;
    let output = utxo
        .output()
        .ok_or_else(|| anyhow::anyhow!("UTXO at {utxo_addr} is burnt"))?;
    let body = output.output();
    let nonce = RistrettoPublicKey::from_canonical_bytes(body.public_nonce.as_bytes())
        .map_err(|e| anyhow::anyhow!("Invalid stealth output public nonce: {e}"))?;
    let decrypted = StealthCryptoApi::new()
        .decrypt_utxo_data(&body.encrypted_data, &commitment, view_secret, &nonce, true)
        .map_err(|e| {
            anyhow::anyhow!("Failed to decrypt stealth UTXO (is it owned by this account?): {e}")
        })?;
    let value = decrypted.value();

    if value <= REVEAL_FEE_BUDGET {
        anyhow::bail!(
            "Stealth UTXO value ({value} µTARI) is not enough to cover the {REVEAL_FEE_BUDGET} µTARI reveal fee"
        );
    }

    // Spend the stealth input and reveal its full value. With only a stealth input (no revealed
    // input) the transfer seals with the input's one-time key, so the revealed bucket is keyed to
    // that key; we deposit it into the account (`deposit` is AllowAll) and pay the fee from a small
    // slice taken off the top.
    let (statement, requirements) = StealthTransfer::new(TARI_TOKEN, provider)
        .spend_stealth_input(owner_addr.clone(), commitment)
        .to_revealed_output(value)
        .prepare()
        .await?;

    let account_public_key = provider.default_signer_address().account_public_key();

    let max_epoch = max_epoch(provider).await?;
    let unsigned = Transaction::builder(network, max_epoch)
        .with_fee_instructions_builder(|b| {
            b.stealth_transfer(TARI_TOKEN, statement)
                .put_last_instruction_output_on_workspace("revealed")
                .take_from_bucket("revealed", REVEAL_FEE_BUDGET, "fee")
                .pay_fee_from_bucket("fee")
                .create_account(*account_public_key)
                .call_method(account_addr, "deposit", args![Workspace("revealed")])
        })
        .add_input(UtxoAddress::new(TARI_TOKEN, UtxoId::from(commitment)))
        .build_unsigned();

    let authorizer = provider.wallet().stealth_authorizer(requirements);
    let tx = TransactionRequest::default()
        .with_transaction(unsigned)
        .build(&authorizer)
        .await?;

    let pending = provider.send_transaction(tx).await?;
    println!("⏳ Reveal transaction submitted: {}", pending.tx_id());
    let outcome = pending.watch().await?;
    println!("🏁 Outcome: {outcome}");
    if let Some(reason) = outcome.reject_reason() {
        anyhow::bail!("❌ Transaction rejected: {reason}");
    }
    let receipt = pending.get_receipt().await?;
    let _ = receipt;
    println!("💧 Revealed {value} µTARI into account {account_addr}");

    Ok(())
}

async fn cmd_show(state: &State) -> anyhow::Result<()> {
    println!("🌐 Network:          {}", state.network);
    println!("🔗 Indexer:          {}", state.indexer_url);
    println!(
        "🏦 Account address:  {}",
        state
            .account_address
            .as_ref()
            .map(|a| a.to_string())
            .unwrap_or_else(|| "Not set".to_string())
    );
    println!(
        "📄 Template address: {}",
        state.template_address.as_deref().unwrap_or("Not set")
    );
    println!(
        "🎮 Organization component:   {}",
        state.component_address.as_ref().display()
    );

    let network = parse_network(&state.network)?;
    let secret = OotleSecretKey::random(network);
    let wallet = OotleWallet::from(PrivateKeyProvider::new(secret.clone()));

    let provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect(&state.indexer_url)
        .await?;

    if !state.users.is_empty() {
        println!("\n👥 Users:");
        for user in &state.users {
            println!("  - {} ({})", user.name, user.account_address);
            let user_wallet = user.to_wallet(network);
            println!(
                "    pubkey: {}",
                *user_wallet.default_address().account_public_key()
            );
            println!("    Balances:");
            let balances = provider.get_account_balances(user.account_address).await?;
            for (res_addr, amt) in balances {
                let res = provider.get_resource(res_addr).await?;

                println!(
                    "    - {}: {} ({})",
                    res.metadata()
                        .get("SYMBOL")
                        .map(|cbor| cbor.decode::<String>().unwrap())
                        .unwrap_or("?".to_string()),
                    amt.to_decimal_string(res.divisibility().into()),
                    res_addr,
                );
            }
        }
    } else {
        println!("\n👥 Users: None");
    }

    if let Some(component_address) = state.component_address {
        let substate = provider.get_substate(component_address).await?;
        if let Some(substate) = substate {
            let org: Organization = substate
                .into_substate_value()
                .into_component()
                .unwrap()
                .body()
                .state
                .decoded()
                .unwrap();

            println!("\nThreshold: {}", org.threshold_ratio);
            println!("Next proposal id: {}", org.next_proposal_id);

            println!("\nBalances:");
            let balances = provider.get_account_balances(component_address).await?;
            for (res_addr, amt) in balances {
                let res = provider.get_resource(res_addr).await?;

                println!(
                    "  - {}: {} ({})",
                    res.metadata()
                        .get("SYMBOL")
                        .map(|cbor| cbor.decode::<String>().unwrap())
                        .unwrap_or("?".to_string()),
                    amt.to_decimal_string(res.divisibility().into()),
                    res_addr,
                );
            }

            if !org.members.is_empty() {
                println!("\n👥 Members:");
                for member in &org.members {
                    println!("  - {}", member);
                }
            } else {
                println!("\n👥 Members: None");
            }

            if !org.proposals.is_empty() {
                println!("\n👥 Active proposals:");
                for (id, proposal) in &org.proposals {
                    println!("  - Id: {}", id);
                    println!("    Action: {}", proposal.action);
                    if !proposal.votes.is_empty() {
                        println!("    Votes:");
                        for (member, vote) in &proposal.votes {
                            println!("    - {}: {}", member, vote);
                        }
                    } else {
                        println!("  Votes: None");
                    }
                }
            } else {
                println!("\n👥 Active proposals: None");
            }
        }
    }

    Ok(())
}
