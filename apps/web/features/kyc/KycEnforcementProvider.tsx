'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAccountVerification } from './hooks/use-account-verification';
import { KycBlockingModal } from './components/KycBlockingModal';
import type { AccountVerificationResponse } from './constants';
import { isPendingDocumentsBlockBypassedForTesting } from './test-bypass';

// ── Context ──────────────────────────────────────────────────────────────

type KycEnforcementContextValue = {
  verification: AccountVerificationResponse | null;
  loading: boolean;
  isApproved: boolean;
  isBlockingOpen: boolean;
  /** Abre o modal de bloqueio com mensagem customizada */
  openBlocking: (_reason?: string) => void;
  refresh: (_fresh?: boolean) => Promise<void>;
};

const KycEnforcementContext = createContext<KycEnforcementContextValue>({
  verification: null,
  loading: true,
  isApproved: false,
  isBlockingOpen: false,
  openBlocking: () => {},
  refresh: async () => {},
});

export function useKycEnforcement() {
  return useContext(KycEnforcementContext);
}

function shouldEnableKycEnforcement(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith('/auth')) return false;
  if (pathname.startsWith('/developer')) return false;
  if (pathname.startsWith('/conta/verificacao')) return false;
  return true;
}

// ── Provider ─────────────────────────────────────────────────────────────

export function KycEnforcementProvider({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const sessionResult = useSession();
  const session = sessionResult?.data;
  const authStatus = sessionResult?.status ?? 'unauthenticated';
  const bypassPendingDocumentsBlock = isPendingDocumentsBlockBypassedForTesting();

  const isAuthenticated = authStatus === 'authenticated' && Boolean(session?.user?.id);
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = typeof role === 'string' && role.toUpperCase() === 'ADMIN';
  const shouldEnable = !bypassPendingDocumentsBlock && shouldEnableKycEnforcement(pathname);

  const { verification, loading, isApproved, refresh } = useAccountVerification({
    enabled: isAuthenticated && isAdmin && shouldEnable,
    poll: shouldEnable,
  });

  const [blockingOpen, setBlockingOpen] = useState(false);
  const [blockingReason, setBlockingReason] = useState<string | undefined>();

  const openBlocking = useCallback((reason?: string) => {
    if (bypassPendingDocumentsBlock) return;
    setBlockingReason(reason);
    setBlockingOpen(true);
  }, [bypassPendingDocumentsBlock]);

  const value: KycEnforcementContextValue = {
    verification,
    loading: bypassPendingDocumentsBlock ? false : loading,
    isApproved: bypassPendingDocumentsBlock ? true : isApproved,
    isBlockingOpen: bypassPendingDocumentsBlock ? false : blockingOpen,
    openBlocking,
    refresh: bypassPendingDocumentsBlock ? async () => {} : refresh,
  };

  return (
    <KycEnforcementContext.Provider value={value}>
      {children}
      {!bypassPendingDocumentsBlock ? (
        <KycBlockingModal
          open={blockingOpen}
          onOpenChange={setBlockingOpen}
          verification={verification}
          reason={blockingReason}
        />
      ) : null}
    </KycEnforcementContext.Provider>
  );
}
