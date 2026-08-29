import { create } from "zustand";
import { persist } from "zustand/middleware";

type FollowData = {};

type OrganizationsStoreState = { organizations: Record<string, FollowData> };

type OrganizationsStoreActions = {
  followOrganization: (organizationId: string) => void;
  unfollowOrganization: (organizationId: string) => void;
};

type OrganizationsStore = OrganizationsStoreState & OrganizationsStoreActions;

export const useOrganizationStore = create<OrganizationsStore>()(
  persist(
    (set, get) => ({
      organizations: {},
      followOrganization: (orgId: string) => {
        const state = get();
        if (orgId in state.organizations) {
          return;
        }
        set({ organizations: { ...get().organizations, [orgId]: {} } });
      },
      unfollowOrganization: (orgId: string) => {
        const state = get();
        if (!(orgId in state.organizations)) {
          return;
        }
        const copy = { ...state.organizations };
        delete copy[orgId];
        set({ organizations: copy });
      },
    }),
    { name: "organizations-storage" },
  ),
);
