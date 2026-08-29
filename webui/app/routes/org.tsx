import {
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  List,
  Typography,
  CardContent,
  Stack,
  Container,
  Box,
  ListItemButton,
  ListItemText,
  Collapse,
  Grid,
  Chip,
  LinearProgress,
} from "@mui/material";
import { useState, type ReactNode } from "react";
import type { Route } from "./+types/org";
import { TransactionBuilder, resolveMaxEpoch } from "@tari-project/ootle";
import { connectProvider, network } from "@/lib/config";
import { waitForTransaction } from "@/lib/transactions";
import { diagnose, encode } from "cbor2";
import { Buffer } from "buffer";
import {
  type Proposal,
  type ProposalAction,
  type ProposalActionSend,
  actionTypeToString,
  ProposalActionType,
} from "@/lib/models";
import { useOrganizationStore } from "@/lib/orgs-store";
import { useQueryClient } from "@tanstack/react-query";
import {
  queryKeys,
  useOrgData,
  useProposalHistory,
  useResourceInfo,
} from "@/lib/queries";
import { getActiveSession, useActiveAccount } from "@/lib/wallet/store";
import { ProposalModal } from "~/components/ProposalModal";
import { DepositModal } from "~/components/DepositModal";
import { LoaderButton } from "~/components/LoaderButton";
import { OrgAvatar } from "~/components/OrgAvatar";
import { MemberAvatar } from "~/components/MemberAvatar";
import { toTitleCase } from "@/lib/case";
import {
  ArrowForward,
  ExpandLess,
  ExpandMore,
  PersonAdd,
  PersonRemove,
  Send,
} from "@mui/icons-material";

const brandRgb = "244, 66, 80"; // #F44250 — Tari red

export function meta({ params }: Route.MetaArgs) {
  const hasPrefix = params.id.startsWith("component_");
  const start = hasPrefix ? "component_".length : 0;
  const shortId = params.id.slice(start, start + 6);
  return [
    { title: `tariorg - Org ${shortId}` },
    {
      name: "description",
      content: "View and manage this organization on Tari.",
    },
  ];
}

export default function Org({ params }: Route.ComponentProps) {
  const id = params.id.startsWith("component_")
    ? params.id
    : `component_${params.id}`;

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [removeMemberOpen, setRemoveMemberOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const organizationsStore = useOrganizationStore();
  const [votingOn, setVotingOn] = useState<Set<number>>(new Set());
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});

  const queryClient = useQueryClient();
  const orgQuery = useOrgData(id);
  const historyQuery = useProposalHistory(id);
  const activeAccount = useActiveAccount();

  const refreshState = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.org(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.proposalHistory(id) });
  };

  if (orgQuery.isError) {
    return (
      <Typography color="error">
        {orgQuery.error instanceof Error
          ? orgQuery.error.message
          : JSON.stringify(orgQuery.error)}
      </Typography>
    );
  }

  if (orgQuery.isPending || !orgQuery.data) {
    return <CircularProgress />;
  }

  const org = orgQuery.data;

  const userIsMember = org.members.includes(
    activeAccount?.ownerPublicKey ?? "",
  );

  const thresholdMembers = Math.ceil(org.thresholdRatio * org.members.length);

  const shortId = id.slice("component_".length);
  const followed = id in organizationsStore.organizations;
  const thresholdPercent = org.thresholdRatio * 100;
  const proposalCount = Object.keys(org.proposals || {}).length;
  // Empty vaults are retained on-chain (matching the builtin account template),
  // so treat zero-balance entries as "no balance" for display.
  const balances = Object.entries(org.vaults).filter(
    ([, vault]) => vault.amount > 0,
  );

  const vote = async (proposalId: number, support: boolean) => {
    setVotingOn((prev) => {
      const next = new Set(prev);
      next.add(proposalId);
      return next;
    });
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[proposalId];
      return next;
    });
    try {
      const session = getActiveSession();
      if (!session) {
        throw new Error("no active account");
      }

      const provider = await connectProvider();

      const proposalIdBytes = encode(proposalId);
      console.log("proposalId", diagnose(proposalIdBytes));
      const proposalIdHex = Buffer.from(proposalIdBytes).toString("hex");

      const supportBytes = encode(support);
      console.log("support", diagnose(supportBytes));
      const supportHex = Buffer.from(supportBytes).toString("hex");

      const unsignedTx = TransactionBuilder.new(
        network(),
        await resolveMaxEpoch(provider),
      )
        .feeTransactionPayFromComponent(session.account.componentAddress, 4000n)
        .callMethod(
          {
            componentAddress: id,
            methodName: "vote",
          },
          [{ Literal: proposalIdHex }, { Literal: supportHex }],
        )
        .buildUnsignedTransaction();

      // if the following isn't set, we are requiered to add the sealer to "other_signers" and the tx is double signed with same key
      unsignedTx.is_seal_signer_authorized = true;

      const txId = await session.submitTransaction(unsignedTx, [id]);

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

      refreshState();
    } catch (err) {
      console.error(err);
      setActionErrors((prev) => ({
        ...prev,
        [proposalId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setVotingOn((prev) => {
        const next = new Set(prev);
        next.delete(proposalId);
        return next;
      });
    }
  };

  const execute = async (proposalId: number) => {
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[proposalId];
      return next;
    });
    try {
      const session = getActiveSession();
      if (!session) {
        throw new Error("no active account");
      }

      const provider = await connectProvider();

      const proposalIdBytes = encode(proposalId);
      console.log("proposalId", diagnose(proposalIdBytes));
      const proposalIdHex = Buffer.from(proposalIdBytes).toString("hex");

      const unsignedTx = TransactionBuilder.new(
        network(),
        await resolveMaxEpoch(provider),
      )
        .feeTransactionPayFromComponent(session.account.componentAddress, 4000n)
        .callMethod(
          {
            componentAddress: id,
            methodName: "execute",
          },
          [{ Literal: proposalIdHex }],
        )
        .buildUnsignedTransaction();

      // if the following isn't set, we are requiered to add the sealer to "other_signers" and the tx is double signed with same key
      unsignedTx.is_seal_signer_authorized = true;

      // Executing a Send proposal withdraws from the org treasury and deposits
      // into the recipient, so the browser backend must also resolve the
      // recipient's component + vaults as inputs. The walletd backend uses
      // `detect_inputs`, so this only matters for in-browser demo accounts.
      const proposal = org.proposals[proposalId];
      const targets =
        proposal.action.type === ProposalActionType.Send
          ? [id, proposal.action.recipient]
          : [id];
      const txId = await session.submitTransaction(unsignedTx, targets);

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
      refreshState();
    } catch (err) {
      console.error(err);
      setActionErrors((prev) => ({
        ...prev,
        [proposalId]: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  return (
    <Box
      component="main"
      sx={{ position: "relative", overflow: "hidden", minHeight: "100%" }}
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
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
        >
          <OrgAvatar orgId={id} size={56} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h4" component="h1">
              Organization
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ wordBreak: "break-all" }}
            >
              {shortId}
            </Typography>
          </Box>
          {followed ? (
            <Button
              variant="outlined"
              onClick={() => organizationsStore.unfollowOrganization(id)}
            >
              Unfollow
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => organizationsStore.followOrganization(id)}
            >
              Follow
            </Button>
          )}
        </Stack>

        {/* Overview */}
        <Grid container spacing={3} sx={{ mt: 3 }}>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="overline" color="text.secondary">
                    Approval threshold
                  </Typography>
                  <Typography variant="h5">
                    {thresholdPercent.toFixed(0)}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {thresholdMembers} of {org.members.length}{" "}
                    {org.members.length === 1 ? "member" : "members"} required
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="overline" color="text.secondary">
                    Your membership
                  </Typography>
                  <Typography
                    variant="h5"
                    color={userIsMember ? "success" : "error"}
                  >
                    {userIsMember ? "Member" : "Not a member"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {userIsMember
                      ? "You can propose and vote in this organization."
                      : "You are not part of this organization's member list."}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Stack spacing={1.5}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography variant="overline" color="text.secondary">
                      Balances
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      data-testid="open-deposit"
                      onClick={() => setDepositOpen(true)}
                    >
                      Deposit
                    </Button>
                  </Stack>
                  {balances.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No balances yet.
                    </Typography>
                  ) : (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: "wrap", gap: 1 }}
                    >
                      {balances.map(([k, v]) => (
                        <Chip
                          key={k}
                          label={`${v.amount / Math.pow(10, v.resource.divisibility)} $${v.resource.metadata["SYMBOL"]}`}
                        />
                      ))}
                    </Stack>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Actions */}
        {userIsMember && (
          <Stack spacing={2} sx={{ mt: 4 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Typography variant="h5" component="h2">
                Actions
              </Typography>
            </Stack>
            <Grid container spacing={3}>
              <ActionCard
                title="Add member"
                description="Propose adding a new member by public key."
                icon={<PersonAdd />}
                onClick={() => setAddMemberOpen(true)}
                testId="action-add-member"
              />
              <ActionCard
                title="Remove member"
                description="Propose removing an existing member."
                icon={<PersonRemove />}
                onClick={() => setRemoveMemberOpen(true)}
                testId="action-remove-member"
              />
              <ActionCard
                title="Send funds"
                description="Propose sending tTARI from the treasury."
                icon={<Send />}
                onClick={() => setSendOpen(true)}
                testId="action-send"
              />
            </Grid>
          </Stack>
        )}

        {/* Members */}
        <Stack spacing={2} sx={{ mt: 4 }}>
          <Typography variant="h5" component="h2">
            Members
          </Typography>
          <Card>
            <CardContent>
              {org.members.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No members yet.
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {org.members.map((member) => (
                    <Stack
                      key={member}
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: "center" }}
                    >
                      <MemberAvatar orgId={member} size={28} />
                      <Typography
                        variant="body2"
                        sx={{ wordBreak: "break-all" }}
                      >
                        {member}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>

        {/* Proposals */}
        <Stack
          direction="row"
          spacing={2}
          sx={{ mt: 4, alignItems: "center", justifyContent: "space-between" }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Typography variant="h5" component="h2">
              Proposals
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label={`${proposalCount} active`}
            />
          </Stack>
        </Stack>

        <ProposalModal
          type={ProposalActionType.AddMember}
          orgId={id}
          open={addMemberOpen}
          onClose={() => setAddMemberOpen(false)}
          refreshState={refreshState}
        />
        <ProposalModal
          type={ProposalActionType.RemoveMember}
          orgId={id}
          open={removeMemberOpen}
          onClose={() => setRemoveMemberOpen(false)}
          refreshState={refreshState}
        />
        <ProposalModal
          type={ProposalActionType.Send}
          orgId={id}
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          refreshState={refreshState}
        />

        <DepositModal
          orgId={id}
          open={depositOpen}
          onClose={() => setDepositOpen(false)}
        />

        {proposalCount === 0 ? (
          <Card
            variant="outlined"
            sx={{
              mt: 2,
              borderStyle: "dashed",
              bgcolor: "transparent",
              textAlign: "center",
            }}
          >
            <CardContent sx={{ py: 6 }}>
              <Stack spacing={2} sx={{ alignItems: "center" }}>
                <Typography variant="h6">No proposals yet</Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ maxWidth: 420 }}
                >
                  {userIsMember
                    ? "Propose an action to start voting on-chain."
                    : "Proposals created by members will appear here."}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        ) : (
          <Grid
            container
            spacing={3}
            columns={{ xs: 1, sm: 1, md: 2, lg: 3 }}
            sx={{ mt: 2 }}
          >
            {Object.entries(org.proposals || {}).map(
              ([proposalId, proposal]) => {
                const userVote =
                  (activeAccount?.ownerPublicKey ?? "") in proposal.votes
                    ? proposal.votes[activeAccount?.ownerPublicKey ?? ""]
                    : null;
                const totalNo = Object.values(proposal.votes).reduce(
                  (sum, vote) => sum + (vote ? 0 : 1),
                  0,
                );
                const canExecute = proposal.totalYes >= thresholdMembers;
                const proposalIdNum = parseInt(proposalId, 10);
                const hasVotes = Object.keys(proposal.votes).length > 0;

                return (
                  <Grid key={proposalId} size={1}>
                    <Card sx={{ height: "100%" }}>
                      <CardContent>
                        <Stack spacing={1.5}>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Typography
                              variant="subtitle1"
                              sx={{ fontWeight: 600 }}
                            >
                              Proposal #{proposalId}
                            </Typography>
                            <Chip
                              size="small"
                              label={toTitleCase(
                                actionTypeToString(proposal.action.type),
                              )}
                            />
                          </Stack>

                          {actionValues(proposal.action)}

                          {userIsMember && (
                            <Stack direction="row" spacing={1}>
                              <LoaderButton
                                onClick={() => vote(proposalIdNum, true)}
                                variant="outlined"
                                disabled={
                                  userVote === true ||
                                  votingOn.has(proposalIdNum)
                                }
                              >
                                Vote yes
                              </LoaderButton>
                              <LoaderButton
                                onClick={() => vote(proposalIdNum, false)}
                                variant="outlined"
                                disabled={
                                  userVote === false ||
                                  votingOn.has(proposalIdNum)
                                }
                              >
                                Vote no
                              </LoaderButton>
                            </Stack>
                          )}

                          {hasVotes && (
                            <>
                              <Stack spacing={1}>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ alignItems: "center" }}
                                >
                                  <LinearProgress
                                    variant="determinate"
                                    value={proposal.totalYes}
                                    color="success"
                                    min={0}
                                    max={thresholdMembers}
                                    sx={{ flex: 1 }}
                                  />
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ minWidth: 96, textAlign: "right" }}
                                  >
                                    Yes {proposal.totalYes}/{thresholdMembers}
                                  </Typography>
                                </Stack>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ alignItems: "center" }}
                                >
                                  <LinearProgress
                                    variant="determinate"
                                    value={totalNo}
                                    color="error"
                                    min={0}
                                    max={thresholdMembers}
                                    sx={{ flex: 1 }}
                                  />
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ minWidth: 96, textAlign: "right" }}
                                  >
                                    No {totalNo}/{thresholdMembers}
                                  </Typography>
                                </Stack>
                              </Stack>

                              {canExecute && (
                                <LoaderButton
                                  variant="contained"
                                  onClick={() => execute(proposalIdNum)}
                                >
                                  Execute
                                </LoaderButton>
                              )}

                              <VotesList proposal={proposal} />
                            </>
                          )}

                          {actionErrors[proposalIdNum] && (
                            <Typography variant="body2" color="error">
                              {actionErrors[proposalIdNum]}
                            </Typography>
                          )}
                        </Stack>
                      </CardContent>
                    </Card>
                  </Grid>
                );
              },
            )}
          </Grid>
        )}

        {/* History */}
        <Stack spacing={2} sx={{ mt: 4 }} data-testid="history">
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Typography variant="h5" component="h2">
              History
            </Typography>
            {historyQuery.data && (
              <Chip
                size="small"
                variant="outlined"
                label={`${historyQuery.data.length} executed`}
              />
            )}
          </Stack>

          {historyQuery.isPending ? (
            <Typography variant="body2" color="text.secondary">
              Loading history…
            </Typography>
          ) : historyQuery.isError ? (
            <Typography variant="body2" color="error">
              {historyQuery.error instanceof Error
                ? historyQuery.error.message
                : JSON.stringify(historyQuery.error)}
            </Typography>
          ) : !historyQuery.data || historyQuery.data.length === 0 ? (
            <Card
              variant="outlined"
              sx={{
                borderStyle: "dashed",
                bgcolor: "transparent",
                textAlign: "center",
              }}
            >
              <CardContent sx={{ py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  No executed proposals yet.
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <Stack spacing={2}>
              {historyQuery.data.map((entry) => (
                <Card key={entry.proposalId} variant="outlined">
                  <CardContent>
                    <Stack spacing={1.5}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        Proposal #{entry.proposalId}
                      </Typography>

                      {actionSummary(entry.action)}

                      <HistoryTimestamp value={entry.executedAt} />
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </Container>
    </Box>
  );
}

function ActionCard({
  title,
  description,
  icon,
  onClick,
  testId,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Card
        variant="outlined"
        sx={{
          height: "100%",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          "&:hover": {
            borderColor: `rgb(${brandRgb})`,
            boxShadow: 2,
          },
        }}
      >
        <CardActionArea
          onClick={onClick}
          data-testid={testId}
          sx={{ height: "100%" }}
        >
          <CardContent>
            <Stack spacing={1.5}>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: "center", justifyContent: "space-between" }}
              >
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 2,
                    color: `rgb(${brandRgb})`,
                    bgcolor: `rgba(${brandRgb}, 0.12)`,
                  }}
                >
                  {icon}
                </Box>
                <ArrowForward sx={{ color: "text.secondary" }} />
              </Stack>
              <Typography variant="h6">{title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            </Stack>
          </CardContent>
        </CardActionArea>
      </Card>
    </Grid>
  );
}

function VotesList({ proposal }: { proposal: Proposal }) {
  const [votesExpanded, setVotesExpanded] = useState(false);
  return (
    <>
      <ListItemButton
        onClick={() => setVotesExpanded(!votesExpanded)}
        sx={{ padding: 0 }}
      >
        <ListItemText
          primary={`${Object.keys(proposal.votes).length} vote(s)`}
        />
        {votesExpanded ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={votesExpanded} timeout="auto" unmountOnExit>
        <List sx={{ paddingBottom: 0 }}>
          {Object.entries(proposal.votes || {}).map(
            ([memberPublicKey, support]) => (
              <li key={memberPublicKey}>
                <Typography
                  variant="body1"
                  color={support ? "success" : "error"}
                  sx={{ wordBreak: "break-all" }}
                >
                  <MemberAvatar orgId={memberPublicKey} size={20} />{" "}
                  {memberPublicKey}: {support ? "yes" : "no"}
                </Typography>
              </li>
            ),
          )}
        </List>
      </Collapse>
    </>
  );
}

function actionValues(action: ProposalAction) {
  switch (action.type) {
    case ProposalActionType.RemoveMember:
    case ProposalActionType.AddMember: {
      return (
        <Typography variant="body1" sx={{ wordBreak: "break-all" }}>
          <MemberAvatar orgId={action.memberPublicKey} size={20} />{" "}
          {action.memberPublicKey}
        </Typography>
      );
    }
    case ProposalActionType.Send: {
      return <SendValues action={action} />;
    }
    case ProposalActionType.Invoke: {
      return (
        <Typography variant="body1" sx={{ wordBreak: "break-all" }}>
          {action.method} on {action.target}
        </Typography>
      );
    }
  }
  return null;
}

function actionSummary(action: ProposalAction) {
  switch (action.type) {
    case ProposalActionType.AddMember:
      return (
        <Typography variant="body1" sx={{ wordBreak: "break-all" }}>
          Add member <MemberAvatar orgId={action.memberPublicKey} size={20} />{" "}
          {action.memberPublicKey}
        </Typography>
      );
    case ProposalActionType.RemoveMember:
      return (
        <Typography variant="body1" sx={{ wordBreak: "break-all" }}>
          Remove member{" "}
          <MemberAvatar orgId={action.memberPublicKey} size={20} />{" "}
          {action.memberPublicKey}
        </Typography>
      );
    case ProposalActionType.Send:
      return <SendValues action={action} verb="Send" />;
    case ProposalActionType.Invoke:
      return (
        <Typography variant="body1" sx={{ wordBreak: "break-all" }}>
          Invoke {action.method} on {action.target}
        </Typography>
      );
  }
  return null;
}

function SendValues({
  action,
  verb,
}: {
  action: ProposalActionSend;
  verb?: string;
}) {
  const resourceQuery = useResourceInfo(action.resource);

  if (resourceQuery.isPending) {
    return (
      <Typography variant="body1" color="text.secondary">
        Loading resource…
      </Typography>
    );
  }

  if (resourceQuery.isError || !resourceQuery.data) {
    return (
      <Typography variant="body1" color="text.secondary">
        Unknown resource
      </Typography>
    );
  }

  const amount = action.amount / Math.pow(10, resourceQuery.data.divisibility);
  const symbol = resourceQuery.data.symbol;
  const prefix = verb ? `${verb} ` : "";

  return (
    <Typography variant="body1" sx={{ wordBreak: "break-all" }}>
      {prefix}
      {amount} {symbol} to {action.recipient}
    </Typography>
  );
}

function formatTimestamp(raw: string | null): string {
  if (!raw) {
    return "";
  }

  let formatted = raw;
  // The indexer serializes a `time::PrimitiveDateTime`, which may use a space
  // separator and omit a timezone; normalise so `Date` parses it as UTC.
  if (!formatted.includes("T")) {
    formatted = formatted.replace(" ", "T");
  }
  if (formatted.endsWith(".0")) {
    formatted = formatted.slice(0, -2);
  }
  if (!/[Z+\-]\d{2}:?\d{2}$/.test(formatted)) {
    formatted += "Z";
  }

  const date = new Date(formatted);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HistoryTimestamp({ value }: { value: string | null }) {
  const formatted = formatTimestamp(value);
  if (!formatted) {
    return null;
  }
  return (
    <Typography variant="body2" color="text.secondary">
      Executed {formatted}
    </Typography>
  );
}
