import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AccountSession, AuthMethod, WalletAccount } from "./types";
import { WalletdSession } from "./walletd";
import {
  buildBrowserSession,
  createBrowserAccount,
  type BrowserSecret,
} from "./browser";

export type WalletStatus =
  "disconnected" | "connecting" | "connected" | "error";

type WalletStoreState = {
  status: WalletStatus;
  error: string | null;
  accounts: WalletAccount[];
  activeAccountId: string | null;
  authMethod: AuthMethod | null;
  /** Hex-encoded secret material for in-browser demo accounts, keyed by id. */
  browserSecrets: Record<string, BrowserSecret>;
};

type WalletStoreActions = {
  connectWalletd: () => Promise<void>;
  createBrowserAccount: (label: string) => Promise<void>;
  setActiveAccount: (id: string) => void;
};

type WalletStore = WalletStoreState & WalletStoreActions;

/** Live session handles, keyed by account id. Never persisted. */
const sessions = new Map<string, AccountSession>();

export const useWalletStore = create<WalletStore>()(
  persist(
    (set, get) => ({
      status: "disconnected",
      error: null,
      accounts: [],
      activeAccountId: null,
      authMethod: null,
      browserSecrets: {},

      connectWalletd: async () => {
        set({ status: "connecting", error: null });
        try {
          const {
            sessions: walletdSessions,
            defaultId,
            authMethod,
          } = await WalletdSession.listSessions();

          for (const session of walletdSessions) {
            sessions.set(session.account.id, session);
          }

          const walletdAccounts = walletdSessions.map((s) => s.account);
          set((state) => {
            // Preserve in-browser demo accounts; replace the walletd set.
            const browserAccounts = state.accounts.filter(
              (a) => a.backend === "browser",
            );
            const accounts = [...browserAccounts, ...walletdAccounts];
            return {
              status: "connected",
              accounts,
              authMethod,
              activeAccountId:
                state.activeAccountId && sessions.has(state.activeAccountId)
                  ? state.activeAccountId
                  : (defaultId ?? accounts[0]?.id ?? null),
            };
          });
        } catch (err) {
          const { accounts } = get();
          const hasDemoAccount = accounts.some((a) => a.backend === "browser");
          if (hasDemoAccount) {
            // A restored demo account keeps the app usable even when walletd is
            // unreachable, so don't show the wallet as "unavailable".
            set({ status: "connected", error: null });
            return;
          }
          // No walletd and no demo account (e.g. the static prod build, which
          // has no local wallet daemon): auto-create an in-browser demo account
          // so the app is immediately usable without a manual click.
          await get().createBrowserAccount(`Demo ${accounts.length + 1}`);
        }
      },

      createBrowserAccount: async (label) => {
        set({ status: "connecting", error: null });
        try {
          const { session, secret } = await createBrowserAccount(label);
          sessions.set(session.account.id, session);
          set((state) => ({
            status: "connected",
            accounts: [...state.accounts, session.account],
            activeAccountId: session.account.id,
            browserSecrets: {
              ...state.browserSecrets,
              [session.account.id]: secret,
            },
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set((state) => {
            const hasDemoAccount = state.accounts.some(
              (a) => a.backend === "browser",
            );
            return {
              status: hasDemoAccount ? "connected" : "error",
              error: message,
            };
          });
        }
      },

      setActiveAccount: (id) => set({ activeAccountId: id }),
    }),
    {
      name: "tariorg-wallet",
      // Only in-browser demo accounts are persisted; walletd accounts are
      // rediscovered on every connect.
      partialize: (state) => ({
        accounts: state.accounts.filter((a) => a.backend === "browser"),
        activeAccountId: state.activeAccountId,
        browserSecrets: state.browserSecrets,
      }),
      onRehydrateStorage: () => (state) => {
        // Rebuild in-memory sessions for restored demo accounts so they can
        // sign again after a refresh.
        if (state) {
          for (const account of state.accounts) {
            const secret = state.browserSecrets[account.id];
            if (secret) {
              sessions.set(account.id, buildBrowserSession(account, secret));
            }
          }
        }
      },
    },
  ),
);

export function getActiveSession(): AccountSession | undefined {
  const { activeAccountId } = useWalletStore.getState();
  return activeAccountId ? sessions.get(activeAccountId) : undefined;
}

export function useActiveAccount(): WalletAccount | null {
  return useWalletStore((state) =>
    state.activeAccountId
      ? (state.accounts.find((a) => a.id === state.activeAccountId) ?? null)
      : null,
  );
}
