'use client';

import React from 'react';
import { useSession } from 'next-auth/react';

import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { ExternalAsaasOnboarding } from '@/components/external-asaas-onboarding/ExternalAsaasOnboarding';
import { shouldShowExternalAsaasApiKeyModal } from '@/lib/external-asaas-api-key-health';

export function ExternalAsaasOnboardingPersistentModal() {
  const { data: session, status } = useSession();
  const mustOpen =
    status === 'authenticated' && shouldShowExternalAsaasApiKeyModal(session?.user);

  if (!mustOpen) {
    return null;
  }

  return (
    <React.Fragment>
      <Dialog open={mustOpen} onOpenChange={() => {}}>
        <DialogContent className="flex w-full max-w-[400px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[400px] sm:rounded-2xl [&>button]:hidden">
          <ExternalAsaasOnboarding variant="modal" />
        </DialogContent>
      </Dialog>
    </React.Fragment>
  );
}
