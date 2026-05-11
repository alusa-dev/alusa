"use client";

import React from 'react';
import Image from "next/image";
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { IntegrationCard } from "./components/IntegrationCard";

function resolveAsaasIntegrationCard(user: {
  financeIntegrationMode?: string | null;
  externalAsaasOnboardingStatus?: string | null;
} | null | undefined) {
  const isExternalMode = user?.financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT';
  const onboardingStatus = user?.externalAsaasOnboardingStatus ?? 'NOT_STARTED';

  if (!isExternalMode) {
    return {
      description: 'Integração financeira whitelabel administrada pela Alusa.',
      status: {
        label: 'Gerenciado pela Alusa',
      },
      href: null,
    };
  }

  if (onboardingStatus === 'READY' || onboardingStatus === 'WEBHOOK_PENDING') {
    return {
      description: 'Gerencie a API key da conta existente e acompanhe o vínculo operacional com o Asaas.',
      status: {
        label: 'Conectado',
        variant: 'success' as const,
      },
      href: '/admin/configuracoes/integracoes/asaas',
    };
  }

  if (onboardingStatus === 'FAILED') {
    return {
      description: 'Revise a credencial da conta existente e reconecte a integração do Asaas.',
      status: {
        label: 'Ajuste necessário',
        variant: 'error' as const,
      },
      href: '/admin/configuracoes/integracoes/asaas',
    };
  }

  return {
    description: 'Cole a API key da sua conta existente e finalize a integração do Asaas pela área dedicada.',
    status: {
      label: 'Conexão pendente',
      variant: 'warning' as const,
    },
    href: '/admin/configuracoes/integracoes/asaas',
  };
}

export function IntegracoesFeature() {
  const router = useRouter();
  const { data: session } = useSession();
  const asaasCard = resolveAsaasIntegrationCard(session?.user);

  return (
    <section className="space-y-4">
      <IntegrationCard
        title="Plataforma de pagamento Asaas"
        description={asaasCard.description}
        icon={
          <Image
            src="/asaas/asaas-icon.png"
            alt="Asaas"
            width={48}
            height={48}
            className="h-12 w-12 object-cover"
            priority
          />
        }
        onClick={asaasCard.href ? () => router.push(asaasCard.href) : undefined}
        status={asaasCard.status}
      />
      {/* Espaço reservado para futuras integrações */}
    </section>
  );
}

export default IntegracoesFeature;
