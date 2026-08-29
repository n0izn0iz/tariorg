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
  "template_fbeb4a341686fd7b5e9771269f97467034cf25ccd59a959646f4e1df87062db6";

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
