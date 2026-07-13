// FILE: forkLinkStore.ts
// Purpose: Client-side persistence of fork lineage (target thread -> source
// thread). Forking is expressed purely as a new thread seeded with context, so
// the "Forked from …" banner and its back-link live here rather than in the
// orchestration schema.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const FORK_LINK_STORAGE_KEY = "t3code:fork-links:v1";

export interface ForkLink {
  readonly sourceEnvironmentId: string;
  readonly sourceThreadId: string;
  readonly sourceTitle: string | null;
  readonly targetProviderDisplayName: string | null;
  readonly createdAt: string;
}

interface ForkLinkStore {
  readonly linksByThreadKey: Readonly<Record<string, ForkLink>>;
  readonly setForkLink: (threadKey: string, link: ForkLink) => void;
  readonly getForkLink: (threadKey: string) => ForkLink | null;
}

export const useForkLinkStore = create<ForkLinkStore>()(
  persist(
    (set, get) => ({
      linksByThreadKey: {},
      setForkLink: (threadKey, link) => {
        set((state) => ({
          linksByThreadKey: { ...state.linksByThreadKey, [threadKey]: link },
        }));
      },
      getForkLink: (threadKey) => get().linksByThreadKey[threadKey] ?? null,
    }),
    {
      name: FORK_LINK_STORAGE_KEY,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : null),
      ),
    },
  ),
);
