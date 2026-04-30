'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Session } from 'next-auth';

// User representa o shape do user que vamos armazenar na store
// (não-nullable para facilitar Partial<User> sem union com null)
type SessionUser = NonNullable<Session['user']>;
export type User = SessionUser & { locale?: string | null; theme?: string | null };

export type UserState = {
  user: User | null;
  setUser: (_u: User | null) => void;
  updateUser: (_partial: Partial<User>) => void;
  clear: () => void;
};

// Estado base (usado tanto com quanto sem persist)
const createBaseState = (
  set: (_updater: (_s: UserState) => Partial<UserState>) => void,
): UserState => ({
  user: null,
  setUser: (u: User | null) => set(() => ({ user: u })),
  updateUser: (partial: Partial<User>) =>
    set((state) => {
      const current = state.user ?? null;
      const merged = current ? ({ ...current, ...partial } as User) : ({ ...partial } as User);
      return { user: merged };
    }),
  clear: () => set(() => ({ user: null })),
});

// Criar store: usar persist somente no cliente (evita accessos a sessionStorage no SSR/testes)
export const useUserStore =
  typeof window !== 'undefined'
    ? create<UserState>()(
        persist(createBaseState, {
          name: 'alusa:user',
          storage: createJSONStorage(() => sessionStorage),
          partialize: (state: UserState) => ({ user: state.user }),
        }),
      )
    : create<UserState>()(createBaseState);

export default useUserStore;
