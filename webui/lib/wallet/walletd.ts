import type {
  KeyId,
  UnsignedTransactionV1,
} from "@tari-project/ootle-ts-bindings";
import { getOotleWalletdClient, getWalletdAuthMethod } from "../ootle-walletd";
import type { AccountSession, AuthMethod, WalletAccount } from "./types";

const DEFAULT_SEAL_SIGNER: KeyId = {
  Derived: { key_branch: "account", index: 0 },
};

/**
 * An account backed by a Tari wallet daemon. Signing happens inside the daemon
 * (via `submitTransaction`), so the secret key never enters the browser.
 */
export class WalletdSession implements AccountSession {
  private constructor(
    public readonly account: WalletAccount,
    private readonly sealSignerKeyId: KeyId,
  ) {}

  static async listSessions(): Promise<{
    sessions: WalletdSession[];
    defaultId: string | null;
    authMethod: AuthMethod | null;
  }> {
    const client = await getOotleWalletdClient();
    const res = await client.accountsList({ offset: 0, limit: 100 });

    let defaultId: string | null = null;
    const sessions = res.accounts.map(({ account }) => {
      const id = account.component_address;
      const label = account.name ?? `${id.slice(0, 10)}…${id.slice(-6)}`;

      const walletAccount: WalletAccount = {
        id,
        backend: "walletd",
        label,
        ownerPublicKey: account.owner_public_key,
        componentAddress: account.component_address,
        isDemo: false,
      };

      if (account.is_default) {
        defaultId = id;
      }

      return new WalletdSession(
        walletAccount,
        account.owner_key_id ?? DEFAULT_SEAL_SIGNER,
      );
    });

    return { sessions, defaultId, authMethod: getWalletdAuthMethod() };
  }

  async submitTransaction(unsignedTx: UnsignedTransactionV1): Promise<string> {
    const client = await getOotleWalletdClient();
    const result = await client.submitTransaction({
      transaction: { V1: unsignedTx },
      detect_inputs: true,
      detect_inputs_use_unversioned: true,
      seal_signer: this.sealSignerKeyId,
      other_signers: [],
      signatures: [],
      lock_ids: [],
    });
    return result.transaction_id;
  }
}
