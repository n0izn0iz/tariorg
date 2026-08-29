import type { UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";

export type AccountBackend = "walletd" | "browser";

/**
 * How the wallet daemon client authenticated. `api-key` means it used a
 * long-lived API key; `none`/`webauthn` are the daemon's advertised methods and
 * were discovered at runtime (auto-detect), never read from the environment.
 */
export type AuthMethod = "api-key" | "none" | "webauthn";

/**
 * A user-selectable account. For `walletd` backends this is an account the
 * daemon manages (keys never enter the browser); for `browser` backends it is
 * a demo account whose secret key lives in JS memory.
 */
export interface WalletAccount {
  /** Stable identifier used for selection. */
  id: string;
  backend: AccountBackend;
  /** Human-readable label (account name, or a shortened address). */
  label: string;
  /** 32-byte (64 hex char) public key. This is the org membership identity. */
  ownerPublicKey: string;
  /** On-chain component address. */
  componentAddress: string;
  /** True for in-browser demo accounts (funds are disposable, keys in memory). */
  isDemo: boolean;
}

/**
 * A live, backend-specific handle that can build-and-submit a transaction on
 * behalf of a single {@link WalletAccount}. Instances are kept out of the
 * persisted store (they hold clients / secret keys) and registered in a
 * module-level registry keyed by account id.
 */
export interface AccountSession {
  readonly account: WalletAccount;
  /**
   * Signs and submits an already-built unsigned transaction, returning its id.
   * `targets` lists the on-chain component addresses the transaction reads or
   * writes besides the account itself, so backend-specific input resolution can
   * add them (browser backend) or the wallet daemon can detect them (walletd).
   */
  submitTransaction(
    unsignedTx: UnsignedTransactionV1,
    targets?: string[],
  ): Promise<string>;
}
