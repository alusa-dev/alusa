'use client';

import React from 'react';
import { useSession } from 'next-auth/react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExternalAsaasOnboarding } from '@/components/external-asaas-onboarding/ExternalAsaasOnboarding';

function shouldRequireApiKey(user: {
  role?: string | null;
  financeStatus?: string | null;
  financeIntegrationMode?: string | null;
  externalAsaasOnboardingStatus?: string | null;
} | null | undefined): boolean {
  const role = user?.role?.toUpperCase() ?? '';
  const isAllowedRole = role === 'ADMIN' || role === 'FINANCEIRO';
  const isExternalMode = user?.financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT';
  const isReady = user?.externalAsaasOnboardingStatus === 'READY';
  const financeStatus = user?.financeStatus ?? null;
  const finishedWizard =
    financeStatus !== null &&
    financeStatus !== 'FINANCE_NOT_STARTED' &&
    financeStatus !== 'FINANCE_ONBOARDING_STARTED';

  return isAllowedRole && isExternalMode && !isReady && finishedWizard;
}

export function ExternalAsaasOnboardingPersistentModal() {
  const { data: session, status } = useSession();
  const mustOpen = status === 'authenticated' && shouldRequireApiKey(session?.user);

  if (!mustOpen) {
    return null;
  }

  return (
    <Dialog open={mustOpen} onOpenChange={() => {}}>
      <DialogContent className="w-full max-w-[500px] gap-0 overflow-hidden p-0 [&>button]:hidden">
        <DialogHeader className="border-b border-slate-100 px-6 py-5 text-left">
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Cole sua API key do Asaas
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Conecte sua conta existente para concluir a etapa financeira.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 py-5">
          <ExternalAsaasOnboarding variant="modal" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
