import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { AccountCircle, Check, ContentCopy } from "@mui/icons-material";
import { useAccountBalance } from "@/lib/queries";
import { NETWORK_NAME } from "@/lib/config";
import {
  useActiveAccount,
  useWalletStore,
  type WalletStatus,
} from "@/lib/wallet/store";
import { MemberAvatar } from "./MemberAvatar";

type Status = "checking" | "connected" | "error";

const STATUS_COLORS: Record<Status, string> = {
  checking: "#f0a020",
  connected: "#22c55e",
  error: "#f44250",
};

const STATUS_LABELS: Record<Status, string> = {
  checking: "Connecting…",
  connected: "Wallet connected",
  error: "Wallet unavailable",
};

function toStatus(status: WalletStatus): Status {
  switch (status) {
    case "connected":
      return "connected";
    case "error":
      return "error";
    default:
      return "checking";
  }
}

export function AccountButton() {
  const status = useWalletStore((state) => state.status);
  const error = useWalletStore((state) => state.error);
  const authMethod = useWalletStore((state) => state.authMethod);
  const accounts = useWalletStore((state) => state.accounts);
  const setActiveAccount = useWalletStore((state) => state.setActiveAccount);
  const connectWalletd = useWalletStore((state) => state.connectWalletd);
  const createBrowserAccount = useWalletStore(
    (state) => state.createBrowserAccount,
  );
  const activeAccount = useActiveAccount();

  useEffect(() => {
    void connectWalletd();
  }, [connectWalletd]);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = Boolean(anchorEl);
  const componentAddress = activeAccount?.componentAddress ?? null;
  const balanceQuery = useAccountBalance(
    componentAddress,
    activeAccount?.backend,
    open,
  );

  const displayStatus: Status = toStatus(status);
  const address = activeAccount?.ownerPublicKey ?? null;

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleCreateDemo = async () => {
    setCreatingDemo(true);
    try {
      const label = `Demo ${accounts.length + 1}`;
      await createBrowserAccount(label);
    } finally {
      setCreatingDemo(false);
    }
  };

  const handleResetState = () => {
    // Wipe all persisted app state (demo accounts, followed organizations) and
    // do a full navigation to home, which also resets in-memory session handles
    // and the query cache.
    localStorage.clear();
    window.location.assign("/");
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedKey(key);
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current);
    }
    copiedTimer.current = setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <>
      <Tooltip title={STATUS_LABELS[displayStatus]}>
        <IconButton
          onClick={handleOpen}
          aria-label="Account"
          data-testid="account-button"
          sx={{ position: "relative", flexShrink: 0 }}
        >
          {displayStatus === "connected" && address ? (
            <MemberAvatar orgId={address} size={24} />
          ) : (
            <AccountCircle sx={{ fontSize: 26, color: "text.secondary" }} />
          )}
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              right: 6,
              bottom: 6,
              width: 9,
              height: 9,
              borderRadius: "50%",
              bgcolor: STATUS_COLORS[displayStatus],
              border: "2px solid",
              borderColor: "background.paper",
            }}
          />
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 320, p: 2 } } }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            {displayStatus === "connected" && address ? (
              <MemberAvatar orgId={address} size={40} />
            ) : (
              <AccountCircle sx={{ fontSize: 40, color: "text.secondary" }} />
            )}
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Account
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {displayStatus === "connected"
                  ? `Connected · ${NETWORK_NAME}`
                  : STATUS_LABELS[displayStatus]}
              </Typography>
            </Stack>
          </Stack>

          {displayStatus === "connected" && authMethod && (
            <Typography variant="caption" color="text.secondary">
              Wallet auth:{" "}
              <Typography
                component="span"
                variant="caption"
                sx={{ fontFamily: "monospace" }}
              >
                {authMethod}
              </Typography>
            </Typography>
          )}

          {error && (
            <Typography
              variant="caption"
              color="error"
              sx={{ wordBreak: "break-word" }}
            >
              {error}
            </Typography>
          )}

          {accounts.length > 1 && (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Accounts
              </Typography>
              {accounts.map((account) => (
                <Button
                  key={account.id}
                  onClick={() => setActiveAccount(account.id)}
                  sx={{
                    justifyContent: "flex-start",
                    gap: 1,
                    px: 1,
                    color: "text.primary",
                    textTransform: "none",
                    bgcolor:
                      account.id === activeAccount?.id
                        ? "action.hover"
                        : "transparent",
                  }}
                >
                  <MemberAvatar orgId={account.ownerPublicKey} size={20} />
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ flex: 1, textAlign: "left" }}
                  >
                    {account.label}
                  </Typography>
                  {account.isDemo && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ textTransform: "none" }}
                    >
                      demo
                    </Typography>
                  )}
                  {account.id === activeAccount?.id && (
                    <Check sx={{ fontSize: 16, color: "primary.main" }} />
                  )}
                </Button>
              ))}
            </Stack>
          )}

          {activeAccount ? (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Public key
              </Typography>
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ alignItems: "center" }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: "monospace",
                    wordBreak: "break-all",
                    flex: 1,
                    minWidth: 0,
                  }}
                  data-testid="account-public-key"
                >
                  {activeAccount.ownerPublicKey}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() =>
                    copyText(activeAccount.ownerPublicKey, "address")
                  }
                  aria-label="Copy address"
                  data-testid="copy-address"
                >
                  {copiedKey === "address" ? (
                    <Check sx={{ fontSize: 18, color: "primary.main" }} />
                  ) : (
                    <ContentCopy sx={{ fontSize: 18 }} />
                  )}
                </IconButton>
              </Stack>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No account found.
            </Typography>
          )}

          {activeAccount?.componentAddress && (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Component address
              </Typography>
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ alignItems: "center" }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: "monospace",
                    wordBreak: "break-all",
                    flex: 1,
                    minWidth: 0,
                  }}
                  data-testid="account-component-address"
                >
                  {activeAccount.componentAddress}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() =>
                    copyText(activeAccount.componentAddress, "component")
                  }
                  aria-label="Copy component address"
                >
                  {copiedKey === "component" ? (
                    <Check sx={{ fontSize: 18, color: "primary.main" }} />
                  ) : (
                    <ContentCopy sx={{ fontSize: 18 }} />
                  )}
                </IconButton>
              </Stack>
            </Stack>
          )}

          {displayStatus === "connected" && activeAccount && (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Balance
              </Typography>
              {balanceQuery.isPending ? (
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              ) : balanceQuery.isError ? (
                <Typography variant="body2" color="text.secondary">
                  Unavailable
                </Typography>
              ) : (
                <Typography variant="body2">
                  {balanceQuery.data
                    ? `${balanceQuery.data.amount.toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })} ${balanceQuery.data.symbol}`
                    : "0 tTARI"}
                </Typography>
              )}
            </Stack>
          )}

          {activeAccount?.isDemo && (
            <Typography variant="caption" color="text.secondary">
              Demo account — keys are in memory and funds are faucet testnet
              tokens. Don't send real value.
            </Typography>
          )}

          <Stack spacing={0.5}>
            <Button
              variant="outlined"
              onClick={handleCreateDemo}
              disabled={creatingDemo}
              data-testid="create-demo-account"
            >
              {creatingDemo ? "Creating…" : "Create demo account"}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Funded from the faucet for trying the app.
            </Typography>
          </Stack>

          <Button
            variant="text"
            color="error"
            size="small"
            onClick={handleResetState}
            data-testid="reset-state"
            sx={{ alignSelf: "flex-start" }}
          >
            Reset state
          </Button>
        </Stack>
      </Popover>
    </>
  );
}
