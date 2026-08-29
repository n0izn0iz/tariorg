import { useEffect, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Modal,
  Stack,
  TextField,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import { TARI_RESOURCE_ADDRESS } from "@tari-project/ootle";
import { ProposalActionType, type ProposalAction } from "@/lib/models";
import { submitProposal } from "@/lib/proposals";
import { useResourceInfo } from "@/lib/queries";
import { addressError, memberPublicKeyError } from "@/lib/validation";
import { LoaderButton } from "./LoaderButton";

const modalStyle: SxProps<Theme> = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 480,
  maxWidth: "calc(100% - 32px)",
  maxHeight: "calc(100% - 32px)",
  overflowY: "auto",
  bgcolor: "background.paper",
  borderRadius: "16px",
  boxShadow: 24,
  boxSizing: "border-box",
  p: { xs: 3, sm: 4 },
  outline: "none",
};

type Config = { title: string; description: string };

function configFor(type: ProposalActionType): Config {
  switch (type) {
    case ProposalActionType.AddMember:
      return {
        title: "Add member",
        description: "Propose adding a member to this organization.",
      };
    case ProposalActionType.RemoveMember:
      return {
        title: "Remove member",
        description: "Propose removing a member from this organization.",
      };
    case ProposalActionType.Send:
      return {
        title: "Send funds",
        description: "Propose sending tTARI from the organization treasury.",
      };
    default:
      return {
        title: "Propose",
        description: "Create a proposal for this organization.",
      };
  }
}

/**
 * A single-action proposal modal. Unlike the old tabbed modal, each instance is
 * locked to one {@link ProposalActionType}: the org page renders one per action
 * card and opens the matching one.
 */
export function ProposalModal({
  type,
  orgId,
  open,
  onClose,
  refreshState,
}: {
  type: ProposalActionType;
  orgId: string;
  open: boolean;
  onClose: () => void;
  refreshState: () => void;
}) {
  const isMemberType =
    type === ProposalActionType.AddMember ||
    type === ProposalActionType.RemoveMember;
  const isSendType = type === ProposalActionType.Send;

  const [memberPublicKey, setMemberPublicKey] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Only the Send action needs the TARI divisibility (to convert whole units to
  // the smallest on-chain units). It is cached, so the extra lookups for the
  // member modals are effectively free.
  const resourceQuery = useResourceInfo(TARI_RESOURCE_ADDRESS);
  const divisibility = resourceQuery.data?.divisibility ?? 0;
  const symbol = resourceQuery.data?.symbol ?? "tTARI";

  useEffect(() => {
    if (open) {
      setError(null);
      setMemberPublicKey("");
      setRecipient("");
      setAmount("");
    }
  }, [open]);

  const memberError = memberPublicKeyError(memberPublicKey);
  const recipientError = addressError(recipient, "component");
  const amountError =
    amount.trim().length === 0
      ? null
      : Number.isFinite(Number(amount)) && Number(amount) > 0
        ? null
        : "Must be a positive number.";

  const canSubmit = isMemberType
    ? memberPublicKey.trim().length > 0 && memberError === null
    : isSendType
      ? recipient.trim().length > 0 &&
        recipientError === null &&
        amount.trim().length > 0 &&
        amountError === null &&
        resourceQuery.data !== undefined
      : false;

  const buildAction = (): ProposalAction => {
    if (isMemberType) {
      return { type, memberPublicKey: memberPublicKey.trim() };
    }
    if (isSendType) {
      // The form works in whole tTARI; the on-chain Send action is in the
      // resource's smallest units (microTARI at divisibility 6).
      const smallestUnits = Math.round(
        Number(amount) * Math.pow(10, divisibility),
      );
      return {
        type: ProposalActionType.Send,
        recipient: recipient.trim(),
        amount: smallestUnits,
        resource: TARI_RESOURCE_ADDRESS,
      };
    }
    throw new Error("unsupported proposal action type");
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      await submitProposal(orgId, buildAction());
      refreshState();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-labelledby="proposal-modal-title"
      aria-describedby="proposal-modal-description"
    >
      <Box sx={modalStyle}>
        <Stack spacing={3}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
          >
            <Box>
              <Typography id="proposal-modal-title" variant="h5" component="h2">
                {configFor(type).title}
              </Typography>
              <Typography
                id="proposal-modal-description"
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {configFor(type).description}
              </Typography>
            </Box>
            <IconButton aria-label="Close" onClick={onClose} size="small">
              <Close />
            </IconButton>
          </Stack>

          {isMemberType && (
            <TextField
              label="Member public key"
              variant="outlined"
              fullWidth
              value={memberPublicKey}
              onChange={(evt) => setMemberPublicKey(evt.target.value)}
              error={memberError !== null}
              helperText={memberError}
              slotProps={{ htmlInput: { "data-testid": "member-public-key" } }}
            />
          )}

          {isSendType && (
            <Stack spacing={2}>
              <TextField
                label="Recipient component address"
                variant="outlined"
                fullWidth
                value={recipient}
                onChange={(evt) => setRecipient(evt.target.value)}
                error={recipientError !== null}
                helperText={recipientError}
                slotProps={{ htmlInput: { "data-testid": "send-recipient" } }}
              />
              <TextField
                label={`Amount (${symbol})`}
                variant="outlined"
                fullWidth
                value={amount}
                onChange={(evt) => setAmount(evt.target.value)}
                inputMode="decimal"
                placeholder="0"
                error={amountError !== null}
                helperText={
                  amountError ?? "Sent from the organization treasury."
                }
                slotProps={{ htmlInput: { "data-testid": "send-amount" } }}
              />
            </Stack>
          )}

          {error !== null && (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          )}

          <Stack
            direction="row"
            spacing={1}
            sx={{ justifyContent: "flex-end" }}
          >
            <Button variant="text" onClick={onClose}>
              Cancel
            </Button>
            <LoaderButton
              variant="contained"
              disabled={!canSubmit}
              data-testid="propose-submit"
              onClick={handleSubmit}
            >
              Propose
            </LoaderButton>
          </Stack>
        </Stack>
      </Box>
    </Modal>
  );
}
