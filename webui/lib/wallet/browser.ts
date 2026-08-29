import {
  TransactionBuilder,
  XTR_FAUCET_CLAIM_RESOURCE_ADDRESS,
  XTR_FAUCET_COMPONENT_ADDRESS,
  XTR_FAUCET_VAULT_ADDRESS,
  fromHexStr,
  getVaultIdsForAccount,
  microTariLiteral,
  resolveMaxEpoch,
  sealTransaction,
  signTransaction,
  toHexStr,
  type SealKeypair,
} from "@tari-project/ootle";
import {
  generateOotleSecretKey,
  publicKeyFromSecretKey,
} from "@tari-project/ootle-wasm";
import type {
  SubstateRequirement,
  UnsignedTransactionV1,
} from "@tari-project/ootle-ts-bindings";
import type { IndexerProvider } from "@tari-project/ootle-indexer";
import { connectProvider, network } from "../config";
import { waitForTransaction } from "../transactions";
import type { AccountSession, WalletAccount } from "./types";

const FAUCET_FEE = 10_000n;

/**
 * The secret material of an in-browser demo account, hex-encoded so it can be
 * persisted (localStorage) and restored across refreshes.
 */
export type BrowserSecret = {
  ownerSecretKey: string;
  viewOnlySecret: string;
};

/**
 * An account whose secret key lives in JS memory. Demo-only: the secret is
 * persisted to localStorage so the account survives a refresh, but funds are
 * still disposable faucet testnet tokens.
 *
 * Transactions are sealed with the account's **owner** key (not a random
 * ephemeral seal key) so that `is_seal_signer_authorized` makes the owner the
 * transaction signer — the same identity the org membership checks see.
 */
export class BrowserSession implements AccountSession {
  constructor(
    public readonly account: WalletAccount,
    private readonly sealKeypair: SealKeypair,
  ) {}

  async submitTransaction(
    unsignedTx: UnsignedTransactionV1,
    targets: string[] = [],
  ): Promise<string> {
    const provider = await connectProvider();
    const inputs = await this.resolveInputs(provider, targets);
    const withInputs = {
      ...unsignedTx,
      inputs: [...unsignedTx.inputs, ...inputs],
    };
    const signed = await signTransaction([], withInputs, this.sealKeypair);
    const envelope = sealTransaction(signed);
    const { transaction_id } = await provider.submitTransaction(envelope);
    return transaction_id;
  }

  private async resolveInputs(
    provider: IndexerProvider,
    targets: string[],
  ): Promise<SubstateRequirement[]> {
    // Dedupe so a target that is also the active account (e.g. a Send proposal
    // that refunds the depositor) isn't listed twice as an input.
    const ids = Array.from(
      new Set([this.account.componentAddress, ...targets]),
    );
    const requirements: SubstateRequirement[] = [];
    for (const id of ids) {
      requirements.push({ substate_id: id, version: null });
      for (const vaultId of await getVaultIdsForAccount(provider, id)) {
        requirements.push({ substate_id: vaultId, version: null });
      }
    }
    return requirements;
  }
}

/**
 * Generate a fresh in-browser account and fund it from the network faucet
 * (which also creates its on-chain account component). Returns the session
 * ready to sign/submit, plus its secret material for persistence.
 */
export async function createBrowserAccount(
  label: string,
): Promise<{ session: BrowserSession; secret: BrowserSecret }> {
  const secret = generateOotleSecretKey();
  const ownerKey = Uint8Array.from(secret.owner_key);
  const viewKey = Uint8Array.from(secret.view_key);
  const sealKeypair: SealKeypair = {
    secret_key: ownerKey,
    public_key: publicKeyFromSecretKey(ownerKey),
  };
  const componentAddress = await faucetAccount(sealKeypair);

  const account: WalletAccount = {
    id: componentAddress,
    backend: "browser",
    label,
    ownerPublicKey: toHexStr(sealKeypair.public_key),
    componentAddress,
    isDemo: true,
  };

  return {
    session: new BrowserSession(account, sealKeypair),
    secret: {
      ownerSecretKey: toHexStr(ownerKey),
      viewOnlySecret: toHexStr(viewKey),
    },
  };
}

/**
 * Rebuild a {@link BrowserSession} from persisted account metadata + secret.
 * Used to restore demo accounts after a page refresh.
 */
export function buildBrowserSession(
  account: WalletAccount,
  secret: BrowserSecret,
): BrowserSession {
  const ownerKey = fromHexStr(secret.ownerSecretKey);
  const sealKeypair: SealKeypair = {
    secret_key: ownerKey,
    public_key: publicKeyFromSecretKey(ownerKey),
  };
  return new BrowserSession(account, sealKeypair);
}

async function faucetAccount(sealKeypair: SealKeypair): Promise<string> {
  const provider = await connectProvider();
  const ownerPublicKeyHex = toHexStr(sealKeypair.public_key);

  const unsigned = new TransactionBuilder(
    network(),
    await resolveMaxEpoch(provider),
  )
    .withFeeInstructionsBuilder((b) =>
      b
        .createAccount(ownerPublicKeyHex)
        .saveVar("account")
        .callMethod(
          {
            componentAddress: XTR_FAUCET_COMPONENT_ADDRESS,
            methodName: "take",
          },
          [{ Workspace: "account" }],
        )
        .callMethod({ fromWorkspace: "account", methodName: "pay_fee" }, [
          microTariLiteral(FAUCET_FEE),
        ]),
    )
    .withInputs([
      { substate_id: XTR_FAUCET_COMPONENT_ADDRESS, version: null },
      { substate_id: XTR_FAUCET_VAULT_ADDRESS, version: null },
      { substate_id: XTR_FAUCET_CLAIM_RESOURCE_ADDRESS, version: null },
    ])
    .buildUnsignedTransaction();

  unsigned.is_seal_signer_authorized = true;

  const signed = await signTransaction([], unsigned, sealKeypair);
  const envelope = sealTransaction(signed);
  const { transaction_id } = await provider.submitTransaction(envelope);

  const res = await waitForTransaction(provider, transaction_id);
  const finalization = res.result.Finalized;
  if (finalization.abort_details) {
    throw new Error(finalization.abort_details);
  }
  if (!finalization.execution_result) {
    throw new Error("faucet claim produced no execution result");
  }

  const created = finalization.execution_result.finalize.events.find(
    (evt) => evt.topic === "std.component.created",
  );
  if (!created || created.substate_id === null) {
    throw new Error("faucet claim did not create an account component");
  }
  return created.substate_id;
}
