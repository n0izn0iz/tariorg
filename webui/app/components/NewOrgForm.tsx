import { Add, Delete } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  InputAdornment,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { Buffer } from "buffer";
import { TransactionBuilder, resolveMaxEpoch } from "@tari-project/ootle";
import { waitForTransaction } from "@/lib/transactions";
import { connectProvider, network } from "@/lib/config";
import { diagnose, encode } from "cbor2";
import { organizationTemplateAddress } from "@/lib/ootle-walletd";
import { getActiveSession, useActiveAccount } from "@/lib/wallet/store";
import { useOrganizationStore } from "@/lib/orgs-store";
import { memberPublicKeyError } from "@/lib/validation";
import { useNavigate } from "react-router";
import { LoaderButton } from "./LoaderButton";
import { randomUint64 } from "@/lib/crypto";

const brandRgb = "244, 66, 80"; // #F44250 — Tari red

type Member = {
  publicKey: string;
};

export function NewOrgForm() {
  const [thresholdPercent, setThresholdPercent] = useState(66);
  const activeAccount = useActiveAccount();
  const [members, setMembers] = useState<Member[]>(() => [
    { publicKey: activeAccount?.ownerPublicKey ?? "" },
  ]);
  const organizationsStore = useOrganizationStore();
  const navigate = useNavigate();
  const [lastError, setLastError] = useState<unknown>();

  // Backfill the sole member once the active account resolves (e.g. a hard
  // reload straight onto /new-org, or a delayed walletd connect). Only fills
  // an untouched first row, so a value the user already typed is preserved.
  useEffect(() => {
    const publicKey = activeAccount?.ownerPublicKey;
    if (!publicKey) {
      return;
    }
    setMembers((prev) => {
      if (prev.length > 0 && prev[0].publicKey === "") {
        return [{ publicKey }, ...prev.slice(1)];
      }
      return prev;
    });
  }, [activeAccount?.ownerPublicKey]);

  const memberErrors = members.map((member) =>
    memberPublicKeyError(member.publicKey),
  );
  const hasEmptyMember = members.some(
    (member) => member.publicKey.trim().length === 0,
  );
  const hasInvalidMember = memberErrors.some((error) => error !== null);
  const thresholdValid = thresholdPercent >= 1 && thresholdPercent <= 100;
  const formInvalid = hasEmptyMember || hasInvalidMember || !thresholdValid;

  const addMember = () => setMembers((prev) => [...prev, { publicKey: "" }]);

  const removeMember = (index: number) =>
    setMembers((prev) => prev.filter((_, i) => i !== index));

  const updateMember = (index: number, publicKey: string) =>
    setMembers((prev) =>
      prev.map((member, i) =>
        i === index ? { ...member, publicKey } : member,
      ),
    );

  const handleCreate = async () => {
    try {
      const session = getActiveSession();
      if (!session) {
        throw new Error("no active account");
      }

      const provider = await connectProvider();

      const membersBytes = encode(
        members.map(
          (member) => new Uint8Array(Buffer.from(member.publicKey, "hex")),
        ),
      );
      console.log("members", diagnose(membersBytes));
      const membersHex = Buffer.from(membersBytes).toString("hex");

      const thresholdBytes = encode(thresholdPercent / 100, {
        avoidInts: true,
        float64: true,
      });
      console.log("threshold", diagnose(thresholdBytes));
      const thresholdHex = Buffer.from(thresholdBytes).toString("hex");

      const unsignedTx = TransactionBuilder.new(
        network(),
        await resolveMaxEpoch(provider),
      )
        .feeTransactionPayFromComponent(session.account.componentAddress, 4000n)
        .callFunction(
          {
            templateAddress: organizationTemplateAddress,
            functionName: "new",
          },
          [{ Literal: membersHex }, { Literal: thresholdHex }],
        )
        .buildUnsignedTransaction();

      unsignedTx.nonce = randomUint64();

      // if the following isn't set, we are requiered to add the sealer to "other_signers" and the tx is double signed with same key
      unsignedTx.is_seal_signer_authorized = true;

      const txId = await session.submitTransaction(unsignedTx);
      console.log(txId);

      const res = await waitForTransaction(provider, txId);
      if (res.result.Finalized.abort_details) {
        throw new Error(res.result.Finalized.abort_details);
      }
      if (!res.result.Finalized.execution_result) {
        throw new Error("no execution result");
      }
      console.log("commited result", res.result);
      const evts = res.result.Finalized.execution_result.finalize.events;
      console.log("events", evts);
      for (const evt of evts) {
        console.log("evt");
        if (evt.topic !== "std.component.created") {
          console.log("bad topic");
          continue;
        }
        if (
          `template_${evt.template_address}` !== organizationTemplateAddress
        ) {
          console.log("bad template address");
          continue;
        }
        if (evt.substate_id === null) {
          console.log("ni substate id");
          continue;
        }

        console.log("following organization", evt.substate_id);
        organizationsStore.followOrganization(evt.substate_id);
        await navigate(`/org/${evt.substate_id}`);
      }
      setLastError(undefined);
    } catch (err) {
      setLastError(err);
      console.error(err);
    }
  };

  return (
    <Box
      component="main"
      sx={{
        position: "relative",
        overflow: "hidden",
        minHeight: "100%",
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(55% 42% at 50% 0%, rgba(${brandRgb}, 0.12) 0%, rgba(${brandRgb}, 0) 70%)`,
        }}
      />

      <Container
        maxWidth="lg"
        sx={{
          position: "relative",
          pt: { xs: 3, md: 4 },
          pb: { xs: 8, md: 10 },
        }}
      >
        {/* Header */}
        <Stack spacing={1.5} sx={{ alignItems: "center", textAlign: "center" }}>
          <Typography
            variant="h4"
            component="h1"
            sx={{ maxWidth: 720, textWrap: "balance" }}
          >
            Create organization
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ maxWidth: 620, textWrap: "pretty" }}
          >
            Choose an approval threshold and add the members who will govern
            your organization on-chain.
          </Typography>
        </Stack>

        <Card
          sx={{
            maxWidth: 720,
            mx: "auto",
            mt: { xs: 4, md: 6 },
          }}
        >
          <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
            <form onSubmit={(event) => event.preventDefault()}>
              <Stack spacing={4}>
                {/* Approval threshold */}
                <Stack spacing={1.5}>
                  <Typography variant="h6" component="h2">
                    Approval threshold
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    The share of members required to approve or reject a
                    proposal.
                  </Typography>

                  <Stack
                    direction="row"
                    spacing={2}
                    sx={{ alignItems: "center" }}
                  >
                    <Slider
                      aria-label="Approval threshold percentage"
                      value={thresholdPercent}
                      onChange={(_, value) => {
                        if (typeof value === "number") {
                          setThresholdPercent(value);
                        }
                      }}
                      min={1}
                      max={100}
                      valueLabelDisplay="auto"
                    />
                    <Box sx={{ minWidth: 56, textAlign: "right" }}>
                      <Typography variant="h6">{thresholdPercent}%</Typography>
                    </Box>
                  </Stack>

                  <Typography variant="body2" color="text.secondary">
                    Requires{" "}
                    {Math.ceil((thresholdPercent / 100) * members.length)} of{" "}
                    {members.length}{" "}
                    {members.length === 1 ? "member" : "members"} to approve or
                    reject.
                  </Typography>
                </Stack>

                {/* Members */}
                <Stack spacing={2}>
                  <Stack
                    direction="row"
                    spacing={2}
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography variant="h6" component="h2">
                      Members
                    </Typography>
                    <Button
                      variant="outlined"
                      startIcon={<Add />}
                      onClick={addMember}
                    >
                      Add member
                    </Button>
                  </Stack>

                  <Stack spacing={2}>
                    {members.map((member, idx) => (
                      <TextField
                        key={idx}
                        label={`Member public key ${idx + 1}`}
                        variant="outlined"
                        fullWidth
                        value={member.publicKey}
                        onChange={(evt) => updateMember(idx, evt.target.value)}
                        error={memberErrors[idx] !== null}
                        helperText={memberErrors[idx]}
                        slotProps={{
                          input: {
                            endAdornment: members.length > 1 && (
                              <InputAdornment position="end">
                                <Button
                                  aria-label={`Remove member ${idx + 1}`}
                                  onClick={() => removeMember(idx)}
                                >
                                  <Delete />
                                </Button>
                              </InputAdornment>
                            ),
                          },
                        }}
                      />
                    ))}
                  </Stack>
                </Stack>

                <LoaderButton
                  variant="contained"
                  size="large"
                  disabled={formInvalid}
                  onClick={handleCreate}
                >
                  Create organization
                </LoaderButton>

                {lastError !== undefined && (
                  <Typography color="error" sx={{ mt: 2 }}>
                    {`${
                      lastError instanceof Error ? lastError.message : lastError
                    }`}
                  </Typography>
                )}
              </Stack>
            </form>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
