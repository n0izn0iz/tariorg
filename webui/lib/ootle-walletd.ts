import { WalletDaemonClient } from "@tari-project/wallet_jrpc_client";
import { authenticate } from "@tari-project/ootle-wallet-daemon-signer";
import { ORGANIZATION_TEMPLATE_ADDRESS, WALLETD_API_KEY } from "@/lib/config";
import type { AuthMethod } from "./wallet/types";

export const organizationTemplateAddress = ORGANIZATION_TEMPLATE_ADDRESS;

const WALLETD_URL = "/walletd/json_rpc";
const APP_NAME = "tariorg-webui";

/**
 * Lazily-authenticated wallet daemon client, cached so repeated submits reuse
 * the same session instead of re-authenticating on every call.
 */
let cachedClient: WalletDaemonClient | null = null;

/** The auth method used for the cached client, set on first connect. */
let cachedAuthMethod: AuthMethod | null = null;

export async function getOotleWalletdClient(): Promise<WalletDaemonClient> {
  if (cachedClient) {
    return cachedClient;
  }

  const client = WalletDaemonClient.usingFetchTransport(WALLETD_URL);
  cachedAuthMethod = await authenticateWalletd(client);
  cachedClient = client;
  return client;
}

/**
 * The effective wallet daemon auth method, or `null` before the first connect.
 * Auto-detected (never read from the environment), so it reflects what the
 * daemon actually accepted.
 */
export function getWalletdAuthMethod(): AuthMethod | null {
  return cachedAuthMethod;
}

/**
 * Authenticate against the wallet daemon by auto-detecting the strategy:
 *
 * 1. **api-key** — if `VITE_WALLETD_API_KEY` is set, use it directly.
 * 2. **none / webauthn** — otherwise probe the daemon via `authGetMethod()` and
 *    exchange the result for a session JWT (delegating to the SDK's
 *    `authenticate`, which handles both flows).
 *
 * Returns the strategy that was actually used, so the UI can report it.
 */
async function authenticateWalletd(
  client: WalletDaemonClient,
): Promise<AuthMethod> {
  if (WALLETD_API_KEY) {
    client.authenticateWithApiKey(WALLETD_API_KEY);
    return "api-key";
  }

  // Probe once to know which method we're about to use (and to report it), then
  // let the SDK helper drive the actual none/webauthn flow.
  const { method } = await client.authGetMethod();
  const token = await authenticate(client, {
    permissions: ["Admin"],
    appName: APP_NAME,
  });
  client.setToken(token);
  client.setReauthenticationEnabled(true);
  return method;
}
