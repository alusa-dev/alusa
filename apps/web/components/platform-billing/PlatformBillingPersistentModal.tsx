'use client';

import { useEffect, useState } from 'react';
import { usePlatformBilling } from '@/features/platform-billing/PlatformBillingContext';
import { PlatformBillingNoticeModal, type PlatformBillingNotice } from './PlatformBillingNoticeModal';
import type {
  PlatformBillingAccessDTO,
  PlatformBillingSummaryDTO,
} from '@/features/platform-billing/dtos/platform-billing-summary';

const STORAGE_VERSION = 'v2';

export function PlatformBillingPersistentModal() {
  const { summary, access, userId } = usePlatformBilling();
  const [notice, setNotice] = useState<PlatformBillingNotice | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const accountId = summary?.account?.id ?? access?.accountId;
    const snapshot = summary?.access ?? access;
    if (!accountId || !snapshot || !userId || typeof window === 'undefined') {
      setNotice(null);
      setOpen(false);
      return;
    }

    const nextNotice = resolveNotice(snapshot);
    if (!nextNotice) {
      setNotice(null);
      setOpen(false);
      return;
    }

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // One communication per account/user/day. The notice resolver already
    // prioritizes restriction over trial/renewal messages, so a state refresh
    // cannot stack multiple persistent dialogs in the same session day.
    const storageKey = `alusa:platform-billing:notice:${STORAGE_VERSION}:${accountId}:${userId}:${today}`;
    try {
      if (window.localStorage.getItem(storageKey) === '1') return;
      window.localStorage.setItem(storageKey, '1');
    } catch {
      // A política de persistência é apenas uma otimização de UX; falha de storage
      // não pode impedir o uso da aplicação.
    }
    setNotice(nextNotice);
    setOpen(true);
  }, [access, summary, userId]);

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

function resolveNotice(access: PlatformBillingSummaryDTO['access'] | PlatformBillingAccessDTO): PlatformBillingNotice | null {

  if (access.accessStatus === 'RESTRICTED' || access.accessStatus === 'CANCELED') {
    const trialExpired = access.restrictionReason === 'TRIAL_EXPIRED';
    return {
      key: trialExpired ? 'trial-expired' : `restricted:${access.restrictionReason ?? access.accessStatus}`,
      title: trialExpired ? 'Seu período gratuito terminou' : 'Conta restrita',
      description: trialExpired
        ? 'Cadastre um cartão para continuar usando as operações da Alusa.'
        : 'Regularize o plano e faturamento para liberar novas operações na plataforma.',
      actionLabel: 'Regularizar pagamento',
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
    if (days === 1) return trialNotice('trial-1', 'Seu teste gratuito termina amanhã. Cadastre um cartão para ativar a renovação automática.');
    if (days === 3) return trialNotice('trial-3', 'Seu teste gratuito termina em 3 dias. Cadastre um cartão para ativar a renovação automática.');
    if (days === 7) return trialNotice('trial-7', 'Seu teste gratuito termina em 7 dias. Cadastre um cartão para ativar a renovação automática.');
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
  return { key, title: 'Seu período gratuito está terminando', description, actionLabel: 'Cadastrar cartão' };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
}
