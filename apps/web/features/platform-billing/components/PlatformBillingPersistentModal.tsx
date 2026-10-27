'use client';

import { useEffect, useState } from 'react';
import { CheckoutResumePopup } from './CheckoutResumePopup';
import { usePlatformBilling } from '@/features/platform-billing/PlatformBillingContext';
import type { PlatformBillingNotice } from './PlatformBillingNoticeModal';
import type {
  PlatformBillingAccessDTO,
  PlatformBillingSummaryDTO,
} from '@/features/platform-billing/dtos/platform-billing-summary';

const STORAGE_VERSION = 'v3';

export function PlatformBillingPersistentModal() {
  const { summary, access, userId } = usePlatformBilling();
  const [notice, setNotice] = useState<PlatformBillingNotice | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    const accountId = summary?.account?.id ?? access?.accountId;
    const snapshot = summary?.access ?? access;
    if (!accountId || !snapshot || !userId || typeof window === 'undefined') {
      setNotice(null);
      setDismissedKey(null);
      return;
    }

    const nextNotice = resolveNotice(snapshot);
    if (!nextNotice) {
      setNotice(null);
      setDismissedKey(null);
      return;
    }

    const storageKey = `alusa:platform-billing:notice:${STORAGE_VERSION}:${accountId}:${userId}:${nextNotice.key}`;
    try {
      setDismissedKey(window.localStorage.getItem(storageKey) === '1' ? storageKey : null);
    } catch {
      setDismissedKey(null);
    }
    setNotice(nextNotice);
  }, [access, summary, userId]);

  if (!notice || dismissedKey?.endsWith(`:${notice.key}`)) return null;

  const dismissNotice = () => {
    const accountId = summary?.account?.id ?? access?.accountId;
    if (!accountId || !userId) return;
    const key = `alusa:platform-billing:notice:${STORAGE_VERSION}:${accountId}:${userId}:${notice.key}`;
    try { window.localStorage.setItem(key, '1'); } catch { /* dismissal remains in memory */ }
    setDismissedKey(key);
  };

  const isRenewed = notice.title === 'Assinatura renovada';
  return (
    <CheckoutResumePopup
      placement="top-right"
      loading={false}
      title={notice.title}
      description={notice.description}
      actionLabel={notice.actionLabel}
      onDismiss={dismissNotice}
      onResume={() => {
        dismissNotice();
        if (!isRenewed) window.location.assign('/account/billing-plan');
      }}
    />
  );
}

function resolveNotice(access: PlatformBillingSummaryDTO['access'] | PlatformBillingAccessDTO): PlatformBillingNotice | null {

  if (access.accessStatus === 'RESTRICTED' || access.accessStatus === 'CANCELED') {
    const trialExpired = access.restrictionReason === 'TRIAL_EXPIRED';
    const canceled = access.accessStatus === 'CANCELED';
    return {
      key: trialExpired ? 'trial-expired' : `${canceled ? 'canceled' : 'restricted'}:${access.restrictionReason ?? access.accessStatus}`,
      title: trialExpired ? 'Seu período gratuito terminou' : canceled ? 'Assinatura cancelada' : 'Conta restrita',
      description: canceled
        ? 'A assinatura foi cancelada. Você continua com acesso para consultar dados da conta, relatórios e financeiro, além de exportações essenciais. Para voltar a criar ou alterar dados, escolha um plano.'
        : trialExpired
        ? 'Escolha contratar e confirme o pagamento para continuar criando e alterando dados na Alusa. Leitura, exportação e obrigações financeiras continuam disponíveis.'
        : 'Regularize o plano e faturamento para liberar novas operações na plataforma.',
      actionLabel: canceled ? 'Ver opções de contratação' : 'Regularizar pagamento',
      tone: 'destructive',
    };
  }

  if (access.accessStatus === 'GRACE_PERIOD') {
    return {
      key: `payment-pending:${access.gracePeriodEndsAt ?? 'unknown'}`,
      title: 'Pagamento pendente',
      description: access.gracePeriodEndsAt
        ? `Atualize o pagamento para evitar restrições. A regularização está disponível até ${formatDate(access.gracePeriodEndsAt)}.`
        : 'Atualize o pagamento para evitar restrições na conta.',
      actionLabel: 'Regularizar pagamento',
      tone: 'destructive',
    };
  }

  if (access.communication.level === 'TRIAL_WARNING' && access.trialEndsAt && !access.hasPaymentMethod) {
    const days = Number(access.communication.noticeKey?.replace('trial-', ''));
    if (days === 1) return trialNotice('trial-1', 'Seu teste gratuito termina amanhã. Depois, você decide se quer contratar e confirma o pagamento.');
    if (days === 3) return trialNotice('trial-3', 'Seu teste gratuito termina em 3 dias. Depois, você decide se quer contratar e confirma o pagamento.');
    if (days === 7) return trialNotice('trial-7', 'Seu teste gratuito termina em 7 dias. Depois, você decide se quer contratar e confirma o pagamento.');
  }

  if (access.communication.level === 'RENEWED') {
    return {
      key: access.communication.noticeKey ?? 'renewed',
      title: 'Assinatura renovada',
      description: 'O pagamento foi confirmado e sua conta continua ativa na Alusa.',
      actionLabel: 'Continuar',
    };
  }

  return null;
}

function trialNotice(key: string, description: string): PlatformBillingNotice {
  return { key, title: 'Seu período gratuito está terminando', description, actionLabel: 'Ver opções de contratação' };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
}
