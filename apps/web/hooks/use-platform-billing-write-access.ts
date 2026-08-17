'use client';

import { useSession } from 'next-auth/react';
import { usePlatformBilling } from '@/features/platform-billing/PlatformBillingContext';

export function usePlatformBillingWriteAccess() {
  const { data: session } = useSession();
  const { summary, access, loading } = usePlatformBilling();
  const role = String((session?.user as { role?: string } | undefined)?.role ?? '').toUpperCase();
  const billingManagedRole = role === 'ADMIN' || role === 'FINANCEIRO';
  const accessStatus = summary?.access.accessStatus ?? access?.accessStatus ?? null;
  const restricted = accessStatus === 'RESTRICTED' || accessStatus === 'CANCELED';
  const policyLoading = billingManagedRole && loading;
  return {
    loading: policyLoading,
    restricted,
    canWrite: billingManagedRole
      ? Boolean(summary?.account && !restricted && !loading)
      : Boolean(accessStatus === 'ACTIVE' || accessStatus === 'GRACE_PERIOD'),
  };
}
