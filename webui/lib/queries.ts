import { useQuery } from "@tanstack/react-query";
import {
  TARI_RESOURCE_ADDRESS,
  getVaultIdsForAccount,
} from "@tari-project/ootle";
import { connectProvider } from "./config";
import { getOotleWalletdClient } from "./ootle-walletd";
import {
  orgFromComponentState,
  proposalActionFromCbor,
  type Organization,
  type ProposalHistoryEntry,
} from "./models";
import type { AccountBackend } from "./wallet/types";

export const queryKeys = {
  accountBalance: (componentAddress: string) =>
    ["account-balance", componentAddress] as const,
  org: (id: string) => ["org", id] as const,
  resource: (address: string) => ["resource", address] as const,
  proposalHistory: (id: string) => ["proposal-history", id] as const,
};

export type AccountBalance = {
  amount: number;
  symbol: string;
};

async function fetchAccountBalance(
  componentAddress: string,
  backend: AccountBackend,
): Promise<AccountBalance | null> {
  if (backend === "browser") {
    return fetchBrowserAccountBalance(componentAddress);
  }

  const client = await getOotleWalletdClient();
  const res = await client.accountsGetBalances({
    account: { ComponentAddress: componentAddress },
    refresh: true,
  });
  const entry = res.balances.find(
    (balance) => balance.resource_address === TARI_RESOURCE_ADDRESS,
  );
  if (!entry) {
    return null;
  }
  return {
    amount: Number(entry.balance) / Math.pow(10, entry.divisibility),
    symbol: entry.token_symbol ?? "tTARI",
  };
}

/**
 * Read an in-browser demo account's TARI balance straight from the indexer.
 * The wallet daemon doesn't know about demo keys, so we resolve the account's
 * vaults and sum their TARI balances instead of asking `accountsGetBalances`.
 */
async function fetchBrowserAccountBalance(
  componentAddress: string,
): Promise<AccountBalance | null> {
  const provider = await connectProvider();
  const vaultIds = await getVaultIdsForAccount(provider, componentAddress);
  const res = await provider.fetchSubstates([
    ...vaultIds,
    TARI_RESOURCE_ADDRESS,
  ]);

  for (const vaultId of vaultIds) {
    const container = res.substates[vaultId];
    if (!container || !("Vault" in container.substate)) {
      continue;
    }
    const rc = container.substate.Vault.resource_container;
    let address: string;
    let amount: number | string | bigint;
    if ("Stealth" in rc) {
      address = rc.Stealth.address;
      amount = rc.Stealth.revealed_amount;
    } else if ("Fungible" in rc) {
      address = rc.Fungible.address;
      amount = rc.Fungible.amount;
    } else {
      continue;
    }
    if (address !== TARI_RESOURCE_ADDRESS) {
      continue;
    }

    const resourceContainer = res.substates[TARI_RESOURCE_ADDRESS];
    if (!resourceContainer || !("Resource" in resourceContainer.substate)) {
      return null;
    }
    const resource = resourceContainer.substate.Resource;
    return {
      amount: Number(amount) / Math.pow(10, resource.divisibility),
      symbol: resource.metadata["SYMBOL"] || "tTARI",
    };
  }

  return null;
}

export function useAccountBalance(
  componentAddress: string | null,
  backend: AccountBackend | null | undefined,
  enabled: boolean,
) {
  const ready =
    enabled &&
    componentAddress !== null &&
    backend !== null &&
    backend !== undefined;
  return useQuery({
    queryKey: queryKeys.accountBalance(componentAddress ?? ""),
    queryFn: () => {
      if (
        componentAddress === null ||
        backend === null ||
        backend === undefined
      ) {
        return null;
      }
      return fetchAccountBalance(componentAddress, backend);
    },
    enabled: ready,
    refetchInterval: ready ? 30_000 : false,
  });
}

async function fetchOrgData(id: string): Promise<Organization> {
  const provider = await connectProvider();
  const res = await provider.fetchSubstates([id]);

  const orgSubstate = res.substates[id];
  if (!orgSubstate || !("Component" in orgSubstate.substate)) {
    throw new Error("not a component substate");
  }
  const orgComponentState = orgSubstate.substate.Component.body.state;
  return orgFromComponentState(provider, orgComponentState);
}

export function useOrgData(id: string) {
  return useQuery({
    queryKey: queryKeys.org(id),
    queryFn: () => fetchOrgData(id),
  });
}

async function fetchProposalHistory(
  id: string,
): Promise<ProposalHistoryEntry[]> {
  const provider = await connectProvider();
  const client = provider.getClient();

  const [proposed, executed] = await Promise.all([
    client.queryTransactionEvents({
      topic: "Organization.Proposed",
      substate_id: id,
      limit: 1000,
      offset: 0,
    }),
    client.queryTransactionEvents({
      topic: "Organization.Executed",
      substate_id: id,
      limit: 1000,
      offset: 0,
    }),
  ]);

  const proposedById = new Map<number, { proposer: string; action: string }>();
  for (const [, event] of proposed.events) {
    const proposalId = Number(event.payload.proposal_id);
    if (!Number.isFinite(proposalId)) {
      continue;
    }
    proposedById.set(proposalId, {
      proposer: event.payload.proposer ?? "",
      action: event.payload.action ?? "",
    });
  }

  // Resolve an execution timestamp for each executed transaction. This is a
  // small, parallelized N+1 (history length is tiny) because the events
  // endpoint doesn't expose the transaction's `created_at` directly.
  const executedTxIds = Array.from(
    new Set(executed.events.map(([transactionId]) => transactionId)),
  );
  const createdAtById = new Map<string, string | null>();
  await Promise.all(
    executedTxIds.map(async (transactionId) => {
      try {
        const result = await client.getTransaction(transactionId);
        createdAtById.set(transactionId, result.transaction.created_at);
      } catch {
        createdAtById.set(transactionId, null);
      }
    }),
  );

  // `get_events` orders by insertion id descending, so executed events are
  // already newest-first — the order we want for a history feed.
  const history: ProposalHistoryEntry[] = [];
  for (const [transactionId, event] of executed.events) {
    const proposalId = Number(event.payload.proposal_id);
    if (!Number.isFinite(proposalId)) {
      continue;
    }
    const proposed = proposedById.get(proposalId);
    if (!proposed) {
      continue;
    }
    history.push({
      proposalId,
      proposer: proposed.proposer,
      action: proposalActionFromCbor(proposed.action),
      executedAt: createdAtById.get(transactionId) ?? null,
    });
  }

  return history;
}

export function useProposalHistory(id: string) {
  return useQuery({
    queryKey: queryKeys.proposalHistory(id),
    queryFn: () => fetchProposalHistory(id),
    // The indexer can lag on indexing transaction events (more than substates),
    // so poll until a newly executed proposal shows up — mirrors the account
    // balance polling.
    refetchInterval: 15_000,
  });
}

export type ResourceInfo = {
  divisibility: number;
  symbol: string;
};

async function fetchResourceInfo(address: string): Promise<ResourceInfo> {
  const provider = await connectProvider();
  const res = await provider.fetchSubstates([address]);
  const resourceState = res.substates[address];
  if (!resourceState || !("Resource" in resourceState.substate)) {
    throw new Error("not a resource substate");
  }
  const resource = resourceState.substate.Resource;
  return {
    divisibility: resource.divisibility,
    symbol: resource.metadata["SYMBOL"] || "?",
  };
}

export function useResourceInfo(address: string) {
  return useQuery({
    queryKey: queryKeys.resource(address),
    queryFn: () => fetchResourceInfo(address),
  });
}
