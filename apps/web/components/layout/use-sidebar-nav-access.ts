'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useKycEnforcement } from '@/features/kyc/KycEnforcementProvider';
import { resolveFinancialCapabilities } from '@/lib/finance/financial-capabilities';
import {
  computeAllowedSidebarGroups,
  SIDEBAR_GROUPS,
  SIDEBAR_PERMISSIONS,
  SIDEBAR_PORTAL_GROUPS,
  type SidebarRoleKey,
} from './sidebar-config';

export function useSidebarNavAccess() {
  const { data: session } = useSession();
  const financeIntegrationMode =
    typeof session?.user === 'object' && session?.user && 'financeIntegrationMode' in session.user
      ? ((session.user as { financeIntegrationMode?: string }).financeIntegrationMode ?? null)
      : null;
  const financialCapabilities = resolveFinancialCapabilities(financeIntegrationMode);
  const role =
    typeof session?.user === 'object' && session?.user && 'role' in session.user
      ? ((session.user as { role?: string }).role as SidebarRoleKey | undefined)
      : undefined;
  const perm =
    role && SIDEBAR_PERMISSIONS[role] ? SIDEBAR_PERMISSIONS[role] : SIDEBAR_PERMISSIONS['RESPONSAVEL'];
  const isPortalUser = role === 'ALUNO' || role === 'RESPONSAVEL';
  const roleUpper = typeof role === 'string' ? role.toUpperCase() : null;
  const { verification, loading: verificationLoading, isApproved } = useKycEnforcement();
  const sidebarLocked =
    !isPortalUser && !verificationLoading && Boolean(verification) && !isApproved;
  const financeLocked = false;
  const shouldLoadAutomaticAnticipationVisibility =
    !isPortalUser &&
    financialCapabilities.canUseAnticipations &&
    (roleUpper === 'ADMIN' || roleUpper === 'FINANCEIRO');
  const [showAutomaticAnticipationItem, setShowAutomaticAnticipationItem] = useState(true);

  const sourceGroups = useMemo(
    () => (role === 'ALUNO' || role === 'RESPONSAVEL' ? SIDEBAR_PORTAL_GROUPS : SIDEBAR_GROUPS),
    [role],
  );

  useEffect(() => {
    if (!shouldLoadAutomaticAnticipationVisibility) {
      setShowAutomaticAnticipationItem(true);
      return;
    }

    const controller = new AbortController();

    async function loadAutomaticAnticipationVisibility() {
      try {
        const response = await fetch('/api/financeiro/antecipacoes/visibilidade', {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          setShowAutomaticAnticipationItem(true);
          return;
        }

        const payload = await response.json();
        setShowAutomaticAnticipationItem(payload?.data?.showAutomaticAnticipationItem !== false);
      } catch {
        if (controller.signal.aborted) return;
        setShowAutomaticAnticipationItem(true);
      }
    }

    void loadAutomaticAnticipationVisibility();

    return () => controller.abort();
  }, [shouldLoadAutomaticAnticipationVisibility]);

  const allowedGroups = useMemo(
    () =>
      computeAllowedSidebarGroups(
        sourceGroups,
        perm,
        financialCapabilities,
        showAutomaticAnticipationItem,
      ),
    [sourceGroups, perm, financialCapabilities, showAutomaticAnticipationItem],
  );

  return {
    role,
    perm,
    isPortalUser,
    financialCapabilities,
    sidebarLocked,
    financeLocked,
    allowedGroups,
    sourceGroups,
  };
}
