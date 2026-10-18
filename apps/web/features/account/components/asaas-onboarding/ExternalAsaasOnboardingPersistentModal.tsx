'use client';

import React from 'react';
import { useSession } from 'next-auth/react';

import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { ExternalAsaasOnboarding } from '@/features/account/components/asaas-onboarding/ExternalAsaasOnboarding';
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
        <DialogContent
          fullScreenMobile
          disableBackdropBlur
          overlayClass="alusa-registration-wizard-overlay"
          className="flex w-full max-w-[400px] flex-col gap-0 overflow-hidden rounded-[20px] bg-white p-0 shadow-lg alusa-dark:bg-[color:var(--color-bg-card)] sm:max-w-[400px] sm:rounded-[20px] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0 [&>button]:hidden"
        >
          <ExternalAsaasOnboarding variant="modal" />
        </DialogContent>
      </Dialog>
    </React.Fragment>
  );
}
