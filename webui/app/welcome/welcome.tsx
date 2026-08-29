import { Link } from "react-router";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import {
  AccountBalance,
  Add,
  ArrowForward,
  Bolt,
  RocketLaunch,
  Shield,
} from "@mui/icons-material";
import { useOrganizationStore } from "@/lib/orgs-store";
import { OrgAvatar } from "../components/OrgAvatar";

const brandRgb = "244, 66, 80"; // #F44250 — Tari red

const features = [
  {
    icon: <AccountBalance />,
    title: "Decentralized governance",
    body: "Member-owned organizations governed by transparent, on-chain rules.",
  },
  {
    icon: <Bolt />,
    title: "Flexible thresholds",
    body: "Set the exact approval threshold your organization needs to move proposals forward.",
  },
  {
    icon: <Shield />,
    title: "On-chain integrity",
    body: "Proposals, votes, and executions are recorded immutably on the Tari L2 network.",
  },
];

// Roadmap items transcribed from the PLANNED notes in `tariorg/src/lib.rs`.
const plannedItems = [
  "Badge-based auth instead of public keys, to support component members, for example orgs hierarchies.",
  "Use dynamic access rules for method auth — benchmark cost against the members list",
  "Allow invoked actions to pass buckets and badges owned by the Organization",
  "Research PrehashedMap from the Account implementation to replace HashMap, and a similar structure for HashSet",
  "Dynamic actions — allow adding and removing actions",
  "Member roles/tags",
  "Conditions: Customizable and composable proposal approval, for example: n-of-role, %-of-role, and, or",
  "RBAC: Granular action condition, allow to set different conditions on different action types",
];

const privacyResearch = [
  "Support stealthy resources",
  "Make votes anonymous",
  "Make members hidden for non-members",
  "Make configuration hidden for non-members",
  "Make actions hidden for non-members",
  "Toggleable and granular privacy — reveal only some things",
];

function PlannedItem({
  text,
  secondary = false,
}: {
  text: string;
  secondary?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
      <Box
        sx={{
          mt: secondary ? 0.5 : 0.7,
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: secondary ? "divider" : `rgb(${brandRgb})`,
        }}
      />
      <Typography
        variant={secondary ? "body2" : "body1"}
        color={secondary ? "text.secondary" : "text.primary"}
      >
        {text}
      </Typography>
    </Stack>
  );
}

export function Welcome() {
  const { organizations } = useOrganizationStore();
  const orgIds = Object.keys(organizations);

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
        {/* Hero */}
        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center" }}>
          <Typography
            variant="h4"
            component="h1"
            sx={{ maxWidth: 720, textWrap: "balance" }}
          >
            Decentralized organizations, on-chain.
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ maxWidth: 620, textWrap: "pretty" }}
          >
            Create, govern, and coordinate organizations on Tari. Propose
            actions, vote on them, and execute decisions — all with on-chain
            transparency.
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Button
              variant="contained"
              size="large"
              startIcon={<Add />}
              component={Link}
              to="/new-org"
            >
              Create organization
            </Button>
          </Stack>
        </Stack>

        {/* Features */}
        <Grid container spacing={3} sx={{ mt: { xs: 6, md: 10 } }}>
          {features.map(({ icon, title, body }) => (
            <Grid key={title} size={{ xs: 12, sm: 4 }}>
              <Card sx={{ height: "100%" }}>
                <CardContent sx={{ height: "100%" }}>
                  <Stack spacing={1.5} sx={{ height: "100%" }}>
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
                    <Typography variant="h6" component="h2">
                      {title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {body}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Planned roadmap */}
        <Stack spacing={3} sx={{ mt: { xs: 6, md: 10 } }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 2,
                  color: `rgb(${brandRgb})`,
                  bgcolor: `rgba(${brandRgb}, 0.12)`,
                }}
              >
                <RocketLaunch fontSize="small" />
              </Box>
              <Typography variant="h5" component="h2">
                Planned
              </Typography>
            </Stack>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ maxWidth: 640 }}
            >
              Ideas under exploration for the on-chain Organization template.
            </Typography>
          </Stack>

          <Card>
            <CardContent>
              <Stack spacing={2.5}>
                {plannedItems.map((item) => (
                  <PlannedItem key={item} text={item} />
                ))}

                <Box
                  sx={{
                    borderRadius: 2,
                    p: 2,
                    bgcolor: "background.default",
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Privacy research topics
                    </Typography>
                    {privacyResearch.map((item) => (
                      <PlannedItem key={item} text={item} secondary />
                    ))}
                  </Stack>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Stack>

        {/* Organizations */}
        <Stack spacing={3} sx={{ mt: { xs: 6, md: 10 } }}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <Typography variant="h5" component="h2">
              Your organizations
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {orgIds.length}{" "}
              {orgIds.length === 1 ? "organization" : "organizations"}
            </Typography>
          </Stack>

          {orgIds.length === 0 ? (
            <Card
              variant="outlined"
              sx={{
                borderStyle: "dashed",
                bgcolor: "transparent",
                textAlign: "center",
              }}
            >
              <CardContent sx={{ py: 6 }}>
                <Stack spacing={2} sx={{ alignItems: "center" }}>
                  <Typography variant="h6">No organizations yet</Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ maxWidth: 420 }}
                  >
                    Create your first organization to start proposing and voting
                    on-chain.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<Add />}
                    component={Link}
                    to="/new-org"
                  >
                    Create organization
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ) : (
            <Grid container spacing={3}>
              {orgIds.map((orgId) => {
                const shortId = orgId.slice("component_".length);
                return (
                  <Grid key={orgId} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Card sx={{ height: "100%" }}>
                      <CardActionArea
                        component={Link}
                        to={`/org/${shortId}`}
                        sx={{ height: "100%" }}
                      >
                        <CardContent>
                          <Stack
                            direction="row"
                            spacing={2}
                            sx={{ alignItems: "center" }}
                          >
                            <OrgAvatar orgId={orgId} size={48} />
                            <Box sx={{ minWidth: 0 }}>
                              <Typography
                                variant="subtitle1"
                                sx={{ fontWeight: 600 }}
                                noWrap
                              >
                                {shortId.slice(0, 12)}…
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ wordBreak: "break-all" }}
                              >
                                {shortId}
                              </Typography>
                            </Box>
                            <ArrowForward
                              sx={{ ml: "auto", color: "text.secondary" }}
                            />
                          </Stack>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </Stack>
      </Container>
    </Box>
  );
}
