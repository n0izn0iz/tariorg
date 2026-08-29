import type { IndexerProvider } from "@tari-project/ootle-indexer";
import type {
  Resource,
  SubstateValue,
  Vault,
} from "@tari-project/ootle-ts-bindings";
import { Tag, decode } from "cbor2";
import { Buffer } from "buffer";

const proposalCborIndex = {
  action: 0,
  votes: 1,
  totalYes: 2,
};
export type Proposal = {
  action: ProposalAction;
  votes: Record<string, boolean>;
  totalYes: number;
};

export function proposalFromState(state: any): Proposal {
  const votesState = state[proposalCborIndex.votes];
  const votes =
    "entries" in votesState
      ? votesState.entries.reduce(
          (res: Record<string, boolean>, vote: any) => ({
            ...res,
            [vote[0].hex]: vote[1],
          }),
          {},
        )
      : {};
  return {
    action: proposalActionFromState(state[proposalCborIndex.action]),
    votes,
    totalYes: state[proposalCborIndex.totalYes],
  };
}

export enum ProposalActionType {
  AddMember = 0,
  RemoveMember = 1,
  Send = 2,
  Invoke = 3,
}

export function actionTypeToString(type: ProposalActionType): string {
  return ProposalActionType[type];
}

export type ProposalActionSend = {
  type: ProposalActionType.Send;
  amount: number;
  resource: string;
  recipient: string;
};

export type ProposalActionInvoke = {
  type: ProposalActionType.Invoke;
  target: string;
  method: string;
  args: unknown;
};

export type ProposalAction =
  | { type: ProposalActionType.AddMember; memberPublicKey: string }
  | { type: ProposalActionType.RemoveMember; memberPublicKey: string }
  | ProposalActionSend
  | ProposalActionInvoke;

/** A successfully executed proposal, reconstructed from indexer events. */
export type ProposalHistoryEntry = {
  proposalId: number;
  /** Public-key hex of the member who proposed it (from the `Proposed` event). */
  proposer: string;
  action: ProposalAction;
  /** When the execute transaction was indexed, or null if unavailable. */
  executedAt: string | null;
};

export function proposalActionFromState(state: any): ProposalAction {
  let data: ProposalAction;
  switch (state[0]) {
    case ProposalActionType.AddMember:
    case ProposalActionType.RemoveMember: {
      data = {
        type: state[0],
        memberPublicKey: state[1][0].hex,
      };
      break;
    }
    case ProposalActionType.Send: {
      data = {
        type: state[0],
        recipient: `component_${state[1][0][0].value.hex}`,
        amount: state[1][0][1],
        resource: `resource_${state[1][0][2].value.hex}`,
      };
      break;
    }
    case ProposalActionType.Invoke: {
      data = {
        type: state[0],
        target: `component_${state[1][0][0].value.hex}`,
        method: state[1][0][1],
        args: state[1][0][2],
      };
      break;
    }
    default: {
      throw new Error("unknown proposal action type");
    }
  }
  return data;
}

function cborBytesToHex(value: unknown): string | null {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  return null;
}

function cborAddressToHex(value: unknown, tag: number): string | null {
  if (!(value instanceof Tag) || value.tag !== tag) {
    return null;
  }
  return cborBytesToHex(value.contents);
}

function cborAmountToNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return null;
}

/**
 * Decode a proposal action from the URL-safe, unpadded base64 CBOR payload
 * emitted in an `Organization.Proposed` event. The on-chain proposal state is
 * deleted on execution, so this is how executed actions are recovered.
 */
export function proposalActionFromCbor(base64: string): ProposalAction {
  const bytes = Buffer.from(
    base64.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  const decoded = decode(bytes);
  if (!Array.isArray(decoded) || decoded.length < 2) {
    throw new Error("invalid proposal action encoding");
  }
  const type = decoded[0];
  const payload = decoded[1];
  if (!Array.isArray(payload)) {
    throw new Error("invalid proposal action payload");
  }

  switch (type) {
    case ProposalActionType.AddMember: {
      const memberPublicKey = cborBytesToHex(payload[0]);
      if (memberPublicKey === null) {
        throw new Error("invalid member public key");
      }
      return { type: ProposalActionType.AddMember, memberPublicKey };
    }
    case ProposalActionType.RemoveMember: {
      const memberPublicKey = cborBytesToHex(payload[0]);
      if (memberPublicKey === null) {
        throw new Error("invalid member public key");
      }
      return { type: ProposalActionType.RemoveMember, memberPublicKey };
    }
    case ProposalActionType.Send: {
      const send = payload[0];
      if (!Array.isArray(send) || send.length < 3) {
        throw new Error("invalid send action");
      }
      const recipient = cborAddressToHex(send[0], 128);
      const resource = cborAddressToHex(send[2], 131);
      const amount = cborAmountToNumber(send[1]);
      if (recipient === null || resource === null || amount === null) {
        throw new Error("invalid send action fields");
      }
      return {
        type: ProposalActionType.Send,
        recipient: `component_${recipient}`,
        amount,
        resource: `resource_${resource}`,
      };
    }
    case ProposalActionType.Invoke: {
      const invoke = payload[0];
      if (!Array.isArray(invoke) || invoke.length < 3) {
        throw new Error("invalid invoke action");
      }
      const target = cborAddressToHex(invoke[0], 128);
      const method = typeof invoke[1] === "string" ? invoke[1] : null;
      if (target === null || method === null) {
        throw new Error("invalid invoke action fields");
      }
      return {
        type: ProposalActionType.Invoke,
        target: `component_${target}`,
        method,
        args: invoke[2],
      };
    }
    default:
      throw new Error("unknown proposal action type");
  }
}

const orgCborIndex = {
  members: 0,
  vaults: 1,
  threshold_ratio: 2,
  proposals: 3,
  next_proposal_id: 4,
};

type VaultRich = { resource: Resource; vault: Vault; amount: number };

export type Organization = {
  members: string[];
  thresholdRatio: number;
  proposals: Record<number, Proposal>;
  vaults: Record<string, VaultRich>;
};

export async function orgFromComponentState(
  provider: IndexerProvider,
  state: any,
): Promise<Organization> {
  const proposalsState = state[orgCborIndex.proposals];
  const proposals =
    "entries" in proposalsState
      ? proposalsState.entries.reduce(
          (res: Record<number, Proposal>, proposal: any) => ({
            ...res,
            [proposal[0]]: proposalFromState(proposal[1]),
          }),
          {},
        )
      : {};
  const vaultsState = state[orgCborIndex.vaults];
  const vaults: Record<string, VaultRich> = {};
  if ("entries" in vaultsState) {
    for (const entry of vaultsState.entries) {
      console.log("entry", entry);
      vaults[entry[0].value.hex] = await vaultFromState(provider, entry[1]);
    }
  }
  return {
    members: state[orgCborIndex.members].map(
      (member: { hex: string }) => member.hex,
    ),
    thresholdRatio: state[orgCborIndex.threshold_ratio],
    proposals: proposals,
    vaults,
  };
}

async function vaultFromState(
  provider: IndexerProvider,
  vaultState: any,
): Promise<VaultRich> {
  const id = "vault_" + vaultState.value.hex;
  const rest = await provider.fetchSubstates([id]);
  const vaultContainer = rest.substates[id];
  if (!vaultContainer || !("Vault" in vaultContainer.substate)) {
    throw new Error("not a vault");
  }
  let amount = 0;
  let resourceAddr;
  const vault = vaultContainer.substate.Vault;
  if ("Stealth" in vault.resource_container) {
    resourceAddr = vault.resource_container.Stealth.address;
    amount = parseFloat(
      vault.resource_container.Stealth.revealed_amount.toString(),
    );
  } else {
    throw new Error(`unknown resource container kind ${Object.keys(vault)[0]}`);
  }
  const resource = await provider.getClient().resourcesGet(resourceAddr);
  return { vault, resource: resource.resource, amount };
}
