import { Network } from "@tari-project/ootle";
import {
  ProviderBuilder,
  type IndexerProvider,
} from "@tari-project/ootle-indexer";

export type NetworkName = "Esmeralda" | "LocalNet";

function env(name: string): string | undefined {
  const value: unknown = import.meta.env[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The Ootle network the webui talks to. Defaults to Esmeralda; set
 * `VITE_NETWORK=LocalNet` (or any other supported network) to override.
 */
const configuredNetwork = env("VITE_NETWORK");
export const NETWORK_NAME: NetworkName =
  configuredNetwork === "Esmeralda" || configuredNetwork === "LocalNet"
    ? configuredNetwork
    : "Esmeralda";

/**
 * Optional indexer URL override. When unset, `connectProvider` uses the default
 * indexer URL for `NETWORK_NAME` (e.g. `http://localhost:12500` on LocalNet).
 */
export const INDEXER_URL: string | undefined = env("VITE_INDEXER_URL");

/**
 * The published Organization template address. Override with
 * `VITE_TEMPLATE_ADDRESS` when pointing at a network whose template was
 * published under a different address.
 */
export const ORGANIZATION_TEMPLATE_ADDRESS: string =
  env("VITE_TEMPLATE_ADDRESS") ??
  "template_827a6a08f656e30cdf0d95946c5349d4a6e2268d86a2fe1dd5f0660930f67732";

/**
 * The demo faucet component address used to fund in-browser accounts. The
 * built-in tXTR faucet is disabled on the live testnet, so we deploy our own
 * (see `tariorg-cli deploy-faucet`) and point the demo-account flow at it here.
 * Override with `VITE_FAUCET_ADDRESS`. `tariorg-cli e2e-infra` sets this on
 * LocalNet too, so the e2e suite exercises the same custom-faucet path.
 */
export const FAUCET_ADDRESS: string | undefined =
  env("VITE_FAUCET_ADDRESS") ||
  "component_89db9758d189fc7a969a1718b68cddcc9cbff5992f44a92a6e3bda5625727844";

/**
 * Optional API key used to authenticate against the wallet daemon JSON-RPC
 * endpoint. When set (e.g. the key minted by `tariorg-cli e2e-infra`), it is
 * used directly. When unset, the webui probes the daemon's configured auth
 * method (`none` or `webauthn`) and authenticates interactively instead.
 */
export const WALLETD_API_KEY: string | undefined = env("VITE_WALLETD_API_KEY");

export function network(): Network {
  return NETWORK_NAME === "LocalNet" ? Network.LocalNet : Network.Esmeralda;
}

/**
 * Builds an indexer provider for the configured network, honouring an explicit
 * `VITE_INDEXER_URL` override when present.
 */
export function connectProvider(): Promise<IndexerProvider> {
  let builder = ProviderBuilder.new().withNetwork(network());
  if (INDEXER_URL) {
    builder = builder.withUrl(INDEXER_URL);
  }
  return builder.connect();
}
