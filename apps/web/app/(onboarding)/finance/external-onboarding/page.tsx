import type { Metadata } from 'next';

import { ExternalAsaasOnboarding } from '@/components/external-asaas-onboarding/ExternalAsaasOnboarding';
import OnboardingShell from '@/components/layout/OnboardingShell';

export const metadata: Metadata = {
  title: 'Conectar Asaas | Alusa',
  description: 'Conecte uma conta existente do Asaas para concluir o onboarding financeiro.',
};

export default function ExternalAsaasOnboardingPage() {
  return (
    <OnboardingShell>
      <ExternalAsaasOnboarding />
    </OnboardingShell>
  );
}