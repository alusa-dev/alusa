'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlatformBilling } from '@/features/platform-billing/PlatformBillingContext';
import { PlatformBillingNoticeModal, type PlatformBillingNotice } from './PlatformBillingNoticeModal';
import type { PlatformBillingSummaryDTO } from '@/features/platform-billing/dtos/platform-billing-summary';

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_VERSION = 'v2';

export function PlatformBillingPersistentModal() {
  const { summary, loading, refresh, userId } = usePlatformBilling();
  const [notice, setNotice] = useState<PlatformBillingNotice | null>(null);
  const [open, setOpen] = useState(false);
  const retryCountRef = useRef(0);

  useEffect(() => {
    retryCountRef.current = 0;
  }, [userId]);

  useEffect(() => {
    if (!userId || loading || summary || retryCountRef.current >= 2) return;

    retryCountRef.current += 1;
    const retryTimer = window.setTimeout(() => {
      void refresh();
    }, 1200);

    return () => window.clearTimeout(retryTimer);
  }, [loading, refresh, summary, userId]);

  useEffect(() => {
    const account = summary?.account;
    if (!account || !userId || typeof window === 'undefined') return;

    const nextNotice = resolveNotice(summary);
    if (!nextNotice) return;

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const storageKey = `alusa:platform-billing:notice:${STORAGE_VERSION}:${account.id}:${userId}:${today}:${nextNotice.key}`;
    try {
      if (window.localStorage.getItem(storageKey) === '1') return;
      window.localStorage.setItem(storageKey, '1');
    } catch {
      // A política de persistência é apenas uma otimização de UX; falha de storage
      // não pode impedir o uso da aplicação.
    }
    setNotice(nextNotice);
    setOpen(true);
  }, [summary, userId]);

  if (!notice) return null;

  return (
    <PlatformBillingNoticeModal
      notice={notice}
      open={open}
      onOpenChange={setOpen}
      onAction={() => {
        setOpen(false);
        window.location.assign('/conta/plano-faturamento');
      }}
    />
  );
}

function resolveNotice(summary: PlatformBillingSummaryDTO): PlatformBillingNotice | null {
  const account = summary.account;
  if (!account) return null;

  if (account.accessStatus === 'RESTRICTED' || account.accessStatus === 'CANCELED') {
    const trialExpired = account.status === 'TRIALING' && account.trialEndsAt && new Date(account.trialEndsAt).getTime() <= Date.now();
    return {
      key: trialExpired ? 'trial-expired' : `restricted:${account.accessStatus}`,
      title: trialExpired ? 'Seu período gratuito terminou' : 'Conta restrita',
      description: trialExpired
        ? 'Cadastre um cartão para continuar usando as operações da Alusa.'
        : 'Regularize o plano e faturamento para liberar novas operações na plataforma.',
      actionLabel: 'Regularizar pagamento',
      tone: 'destructive',
    };
  }

  if (account.accessStatus === 'GRACE_PERIOD') {
    return {
      key: `payment-pending:${account.gracePeriodEndsAt ?? 'unknown'}`,
      title: 'Pagamento pendente',
      description: account.gracePeriodEndsAt
        ? `Atualize o pagamento para evitar restrições. A regularização está disponível até ${formatDate(account.gracePeriodEndsAt)}.`
        : 'Atualize o pagamento para evitar restrições na conta.',
      actionLabel: 'Regularizar pagamento',
      tone: 'destructive',
    };
  }

  if (account.status === 'TRIALING' && account.trialEndsAt && summary.paymentMethod.status !== 'present') {
    const remaining = new Date(account.trialEndsAt).getTime() - Date.now();
    const days = Math.ceil(remaining / DAY_MS);
    if (days === 1) return trialNotice('trial-1', 'Seu teste gratuito termina amanhã. Cadastre um cartão para ativar a renovação automática.');
    if (days === 3) return trialNotice('trial-3', 'Seu teste gratuito termina em 3 dias. Cadastre um cartão para ativar a renovação automática.');
    if (days === 7) return trialNotice('trial-7', 'Seu teste gratuito termina em 7 dias. Cadastre um cartão para ativar a renovação automática.');
  }

  const latestWebhook = summary.health.lastWebhook;
  if (
    account.status === 'ACTIVE' &&
    latestWebhook?.processedAt &&
    Date.now() - new Date(latestWebhook.processedAt).getTime() <= DAY_MS &&
    (latestWebhook.eventType === 'invoice.paid' || latestWebhook.eventType === 'invoice.payment_succeeded')
  ) {
    return {
      key: `renewed:${latestWebhook.eventId}`,
      title: 'Assinatura renovada',
      description: 'O pagamento foi confirmado e sua conta continua ativa na Alusa.',
      actionLabel: 'Continuar',
    };
  }

  return null;
}

function trialNotice(key: string, description: string): PlatformBillingNotice {
  return { key, title: 'Seu período gratuito está terminando', description, actionLabel: 'Cadastrar cartão' };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
}
