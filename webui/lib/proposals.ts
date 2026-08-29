import { TransactionBuilder, resolveMaxEpoch } from "@tari-project/ootle";
import { Buffer } from "buffer";
import { Tag, encode } from "cbor2";
import { connectProvider, network } from "./config";
import { ProposalActionType, type ProposalAction } from "./models";
import { waitForTransaction } from "./transactions";
import { addressBody } from "./validation";
import { getActiveSession } from "./wallet/store";

/**
 * Encode the data portion of a proposal action for CBOR. The `[type, data]`
 * tuple is encoded by the caller; this returns the `data` element only.
 */
export function encodeActionData(action: ProposalAction): unknown {
  switch (action.type) {
    case ProposalActionType.RemoveMember:
    case ProposalActionType.AddMember: {
      return [new Uint8Array(Buffer.from(action.memberPublicKey, "hex"))];
    }
    case ProposalActionType.Send: {
      const recipientBody = addressBody(action.recipient, "component");
      const resourceBody = addressBody(action.resource, "resource");

      if (recipientBody === null || resourceBody === null) {
        throw new Error("invalid send proposal addresses");
      }

      const recipient = new Tag(
        128,
        new Uint8Array(Buffer.from(recipientBody, "hex")),
      );
      const resource = new Tag(
        131,
        new Uint8Array(Buffer.from(resourceBody, "hex")),
      );

      return [[recipient, action.amount, resource]];
    }
    case ProposalActionType.Invoke: {
      return [action.target, action.method, action.args];
    }
  }
}

/**
 * Build, submit, and wait for a `propose` transaction, returning the newly
 * created proposal id. Throws on any failure (the caller surfaces the error).
 */
export async function submitProposal(
  orgId: string,
  action: ProposalAction,
): Promise<number> {
  const session = getActiveSession();
  if (!session) {
    throw new Error("no active account");
  }

  const provider = await connectProvider();

  const actionBytes = encode([action.type, encodeActionData(action)]);
  const actionHex = Buffer.from(actionBytes).toString("hex");

  const unsignedTx = TransactionBuilder.new(
    network(),
    await resolveMaxEpoch(provider),
  )
    .feeTransactionPayFromComponent(session.account.componentAddress, 4000n)
    .callMethod(
      {
        componentAddress: orgId,
        methodName: "propose",
      },
      [{ Literal: actionHex }],
    )
    .buildUnsignedTransaction();

  // If this isn't set, the sealer must be added to `other_signers` and the
  // transaction gets double-signed with the same key.
  unsignedTx.is_seal_signer_authorized = true;

  const txId = await session.submitTransaction(unsignedTx, [orgId]);

  const res = await waitForTransaction(provider, txId);
  if (res.result.Finalized.abort_details) {
    throw new Error(res.result.Finalized.abort_details);
  }
  if (!res.result.Finalized.execution_result) {
    throw new Error("no execution result");
  }

  const evts = res.result.Finalized.execution_result.finalize.events;
  let proposalId: number | undefined;
  for (const evt of evts) {
    if (evt.topic === "Organization.Proposed" && evt.substate_id === orgId) {
      if (evt.payload.proposal_id) {
        proposalId = parseInt(evt.payload.proposal_id, 10);
      }
    }
  }

  if (proposalId === undefined) {
    throw new Error("proposal id not found in events");
  }

  return proposalId;
}
