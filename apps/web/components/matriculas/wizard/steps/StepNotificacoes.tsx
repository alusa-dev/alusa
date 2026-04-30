'use client';

import { useEffect, useState } from 'react';
import { SectionCard, StepHeader } from '@/components/alunos/wizard/ui';
import { asaasNotificationPreferencesResultDTOSchema } from '@/features/configuracoes/notificacoes/asaas/dtos';
import { type CustomerNotificationChannel } from '@/features/configuracoes/notificacoes/asaas/customer-channel-defaults';
import { cn } from '@/lib/utils';
import type { WizardContextValue, WizardNotificationChannel } from '../types';

interface StepNotificacoesProps {
  ctx: WizardContextValue;
}

const CHANNEL_OPTIONS: Array<{ value: WizardNotificationChannel; label: string }> = [
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'SMS', label: 'SMS' },
];

export function StepNotificacoes({ ctx }: StepNotificacoesProps) {
  const { state, update } = ctx;
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  useEffect(() => {
    if (state.notificationChannelsInitialized) return;
    if (!state.contaId) {
      update({
        notificationChannelsInitialized: true,
        notificationChannelsConfigured: false,
        notificationChannels: [],
      });
      return;
    }

    let cancelled = false;

    const loadDefaults = async () => {
      setLoadingDefaults(true);
      try {
        const response = await fetch('/api/configuracoes/notificacoes/asaas', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error('Falha ao carregar configuração de notificações.');
        }

        const raw = await response.json();
        const parsed = asaasNotificationPreferencesResultDTOSchema.parse(raw);
        if (cancelled) return;

        setDefaultsError(null);
        update({
          notificationChannels:
            parsed.customerChannelDefaults as CustomerNotificationChannel[],
          notificationChannelsInitialized: true,
          notificationChannelsConfigured: true,
        });
      } catch {
        if (cancelled) return;
        setDefaultsError(
          'Não foi possível carregar o padrão da conta. Se você avançar sem marcar canais, o cliente mantém a configuração atual já aplicada.',
        );
        update({
          notificationChannelsInitialized: true,
          notificationChannelsConfigured: false,
          notificationChannels: [],
        });
      } finally {
        if (!cancelled) {
          setLoadingDefaults(false);
        }
      }
    };

    void loadDefaults();

    return () => {
      cancelled = true;
    };
  }, [state.contaId, state.notificationChannelsInitialized, update]);

  const toggleChannel = (channel: WizardNotificationChannel) => {
    const active = state.notificationChannels.includes(channel);
    update({
      notificationChannels: active
        ? state.notificationChannels.filter((item) => item !== channel)
        : [...state.notificationChannels, channel],
      notificationChannelsInitialized: true,
      notificationChannelsConfigured: true,
    });
  };

  return (
    <SectionCard>
      <StepHeader
        title="Notificações"
        hint="Defina quais canais serão usados nas cobranças geradas para esta matrícula."
      />

      <div className="space-y-4">
        {loadingDefaults ? <p className="text-sm text-slate-500">Carregando configuração atual...</p> : null}
        {defaultsError ? <p className="text-sm text-amber-700">{defaultsError}</p> : null}

        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <div className="flex flex-wrap gap-3">
            {CHANNEL_OPTIONS.map((option) => {
              const active = state.notificationChannels.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleChannel(option.value)}
                  className={cn(
                    'inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition',
                    active
                      ? 'border-brand-accent bg-brand-accent text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
