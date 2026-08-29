import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Modal,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close } from "@mui/icons-material";
import {
  TARI_RESOURCE_ADDRESS,
  TransactionBuilder,
  amountLiteral,
  resolveMaxEpoch,
  resourceAddressLiteral,
} from "@tari-project/ootle";
import { useQueryClient } from "@tanstack/react-query";
import { connectProvider, network } from "@/lib/config";
import { waitForTransaction } from "@/lib/transactions";
import { randomUint64 } from "@/lib/crypto";
import { queryKeys, useResourceInfo } from "@/lib/queries";
import { getActiveSession } from "@/lib/wallet/store";
import { LoaderButton } from "./LoaderButton";

export function DepositModal({
  orgId,
  open,
  onClose,
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const resourceQuery = useResourceInfo(TARI_RESOURCE_ADDRESS);
  const [amount, setAmount] = useState("");
  const [lastError, setLastError] = useState<unknown>();

  const divisibility = resourceQuery.data?.divisibility ?? 0;
  const symbol = resourceQuery.data?.symbol ?? "tTARI";

  const parsedAmount = Number(amount);
  const amountValid =
    amount.trim().length > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;

  const deposit = async () => {
    if (!resourceQuery.data) {
      setLastError(new Error("TARI resource info not loaded yet"));
      return;
    }

    try {
      const session = getActiveSession();
      if (!session) {
        throw new Error("no active account");
      }

      const provider = await connectProvider();
      const accountAddr = session.account.componentAddress;

      const smallestUnits = BigInt(
        Math.round(parsedAmount * Math.pow(10, divisibility)),
      );

      const unsignedTx = TransactionBuilder.new(
        network(),
        await resolveMaxEpoch(provider),
      )
        .feeTransactionPayFromComponent(accountAddr, 4000n)
        .callMethod({ componentAddress: accountAddr, methodName: "withdraw" }, [
          resourceAddressLiteral(TARI_RESOURCE_ADDRESS),
          amountLiteral(smallestUnits),
        ])
        .saveVar("bucket")
        .callMethod({ componentAddress: orgId, methodName: "deposit" }, [
          { Workspace: "bucket" },
        ])
        .buildUnsignedTransaction();

      // if the following isn't set, we are requiered to add the sealer to "other_signers" and the tx is double signed with same key
      unsignedTx.is_seal_signer_authorized = true;
      unsignedTx.nonce = randomUint64();

      const txId = await session.submitTransaction(unsignedTx, [orgId]);

      const res = await waitForTransaction(provider, txId);
      if (res.result.Finalized.abort_details) {
        throw new Error(res.result.Finalized.abort_details);
      }
      if (!res.result.Finalized.execution_result) {
        throw new Error("no execution result");
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.org(orgId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.accountBalance(accountAddr),
      });

      setAmount("");
      setLastError(undefined);
      onClose();
    } catch (err) {
      setLastError(err);
      console.error(err);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-labelledby="deposit-modal-title"
      aria-describedby="deposit-modal-description"
    >
      <Box
        sx={{
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
        }}
      >
        <Stack spacing={3}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
          >
            <Box>
              <Typography id="deposit-modal-title" variant="h5" component="h2">
                Deposit
              </Typography>
              <Typography
                id="deposit-modal-description"
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Move {symbol} from your account into this organization's
                treasury.
              </Typography>
            </Box>
            <IconButton aria-label="Close" onClick={onClose} size="small">
              <Close />
            </IconButton>
          </Stack>

          <TextField
            label={`Amount (${symbol})`}
            variant="outlined"
            fullWidth
            value={amount}
            onChange={(evt) => setAmount(evt.target.value)}
            inputMode="decimal"
            placeholder="0"
            error={amount.trim().length > 0 && !amountValid}
            helperText={
              amount.trim().length > 0 && !amountValid
                ? "Must be a positive number."
                : `Deposited into the organization treasury.`
            }
            slotProps={{ htmlInput: { "data-testid": "deposit-amount" } }}
          />

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
              disabled={!amountValid}
              data-testid="deposit-submit"
              onClick={deposit}
            >
              Deposit
            </LoaderButton>
          </Stack>

          {lastError !== undefined && (
            <Typography color="error" sx={{ mt: 2 }}>
              {`${lastError instanceof Error ? lastError.message : lastError}`}
            </Typography>
          )}
        </Stack>
      </Box>
    </Modal>
  );
}
