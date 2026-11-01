'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAsaasNotificationSettings } from './hooks/useAsaasNotificationSettings';
import type { NotificationPreference } from './types';

type ProviderChannel = 'emailEnabledForProvider' | 'smsEnabledForProvider';

const channels: Array<{ key: 'customerEmailNotificationsEnabled' | 'customerWhatsAppNotificationsEnabled' | 'customerSmsNotificationsEnabled'; id: 'email' | 'whatsapp' | 'sms'; label: string }> = [
  { key: 'customerEmailNotificationsEnabled', id: 'email', label: 'E-mail' },
  { key: 'customerWhatsAppNotificationsEnabled', id: 'whatsapp', label: 'WhatsApp' },
  { key: 'customerSmsNotificationsEnabled', id: 'sms', label: 'SMS' },
];

const primaryRows = [
  { id: 'created', title: 'Ao criar cobrança', event: 'PAYMENT_CREATED', offset: 0, tooltip: 'Não se aplica a cobranças geradas automaticamente por assinaturas.' },
  { id: 'before', title: 'Antes do vencimento', event: 'PAYMENT_DUEDATE_WARNING', offset: 10, select: { offsets: [5, 10, 15, 30], label: 'dias antes' } },
  { id: 'due', title: 'No vencimento', event: 'PAYMENT_DUEDATE_WARNING', offset: 0 },
  { id: 'overdue', title: 'Quando a cobrança estiver atrasada', event: 'PAYMENT_OVERDUE', offset: 0 },
  { id: 'reminder', title: 'Lembretes atrasados', event: 'PAYMENT_OVERDUE', offset: 7, select: { offsets: [1, 7, 15, 30], label: 'dias depois' } },
  { id: 'received', title: 'Quando o pagamento for recebido', event: 'PAYMENT_RECEIVED', offset: 0 },
] as const;
const otherRows = [
  { id: 'updated', title: 'Cobrança alterada', event: 'PAYMENT_UPDATED', offset: 0 },
  { id: 'line', title: 'Linha digitável não visualizada', event: 'SEND_LINHA_DIGITAVEL', offset: 0, noWhatsapp: true },
] as const;
type NotificationRow = (typeof primaryRows)[number] | (typeof otherRows)[number];

const eventLabels: Record<NotificationPreference['event'], string> = {
  PAYMENT_CREATED: 'Cobrança criada',
  PAYMENT_UPDATED: 'Cobrança atualizada',
  PAYMENT_DUEDATE_WARNING: 'Aviso de vencimento',
  SEND_LINHA_DIGITAVEL: 'Linha digitável não visualizada',
  PAYMENT_OVERDUE: 'Cobrança atrasada',
  PAYMENT_RECEIVED: 'Pagamento recebido',
};

function scheduleDescription(event: NotificationPreference['event'], offset: number): string | null {
  if (event === 'PAYMENT_DUEDATE_WARNING') {
    return offset === 0 ? 'No vencimento' : `${offset} ${offset === 1 ? 'dia' : 'dias'} antes do vencimento`;
  }
  if (event === 'PAYMENT_OVERDUE') {
    return offset === 0 ? 'No primeiro dia de atraso' : `${offset} ${offset === 1 ? 'dia' : 'dias'} após o vencimento`;
  }
  return null;
}

function preferenceForRow(preferences: NotificationPreference[], row: NotificationRow) {
  if ('select' in row) return preferences.find((item) => item.event === row.event && item.scheduleOffset > 0);
  return preferences.find((item) => item.event === row.event && item.scheduleOffset === row.offset);
}

export function AsaasNotificationSettings() {
  const {
    loading, saving, error, preferences, policy, synchronization, hasChanges,
    fetchPreferences, updatePreference, savePreferences, reset,
    setCustomerNotificationsEnabled, setCustomerChannelEnabled, setContractNotificationsEnabled, setContractChannelEnabled,
  } = useAsaasNotificationSettings();
  const [otherOpen, setOtherOpen] = useState(false);
  const [schoolOpen, setSchoolOpen] = useState(false);

  useEffect(() => {
    if (!hasChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasChanges]);

  function renderRow(row: NotificationRow) {
    const preference = preferenceForRow(preferences, row);
    if (!preference) return null;
    return (
      <div key={row.id} className="grid gap-4 py-5 sm:grid-cols-[minmax(13rem,1fr)_auto] sm:items-center">
        <div className="flex items-start gap-3">
          <Checkbox
            aria-label={`Aviso ${row.title}`}
            checked={preference.customerEnabled}
            disabled={saving}
            onCheckedChange={(checked) => updatePreference(preference.event, preference.scheduleOffset, { customerEnabled: Boolean(checked) })}
            className="mt-0.5 h-5 w-5 rounded-full"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-gray-900">{row.title}</p>
              {'tooltip' in row && row.tooltip ? (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Informações sobre o aviso ao criar cobrança"
                        aria-describedby="payment-created-subscription-note"
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2"
                      >
                        <Info aria-hidden="true" className="h-4 w-4" />
                        <span id="payment-created-subscription-note" className="sr-only">{row.tooltip}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-left leading-relaxed">
                      {row.tooltip}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
          </div>
        </div>
        {'select' in row && preference.customerEnabled ? (
          <div className="flex items-center gap-2 text-sm text-gray-600 sm:justify-end">
            <span>Enviar</span>
            <Select value={String(preference.scheduleOffset)} disabled={saving} onValueChange={(value) => updatePreference(preference.event, preference.scheduleOffset, { scheduleOffset: Number(value) })}>
            <SelectTrigger aria-label={`Intervalo — ${row.title}`} className="h-9 w-20 border-0 bg-gray-50 shadow-none focus-visible:ring-2 focus-visible:ring-brand-accent/35 focus-visible:ring-offset-2 data-[state=open]:border-0 data-[state=open]:bg-gray-50"><SelectValue /></SelectTrigger>
              <SelectContent>{row.select.offsets.map((offset) => <SelectItem key={offset} value={String(offset)}>{offset}</SelectItem>)}</SelectContent>
            </Select>
            <span>{row.select.label}</span>
          </div>
        ) : null}
      </div>
    );
  }

  const divider = 'divide-y divide-gray-100';
  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
      {error ? <Alert variant="destructive"><AlertTitle>Falha ao carregar notificações</AlertTitle><AlertDescription className="mt-1 flex items-center gap-3"><span>{error}</span><Button variant="outline" size="sm" onClick={fetchPreferences}>Tentar novamente</Button></AlertDescription></Alert> : null}
      <section aria-labelledby="billing-notifications-heading" className="rounded-2xl border border-gray-200 bg-white px-5 sm:px-6">
        <header className="flex flex-col gap-4 border-b border-gray-100 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="billing-notifications-heading" className="text-base font-semibold text-gray-900">Notificações de cobrança</h2>
            <p className="mt-1 text-sm text-gray-500">Escolha quando e por quais canais os pagadores recebem avisos automáticos.</p>
          </div>
          <div className="inline-flex w-fit rounded-lg bg-gray-50 p-1" role="radiogroup" aria-label="Avisos automáticos para pagadores">
            {([false, true] as const).map((enabled) => (
              <button key={String(enabled)} type="button" role="radio" aria-checked={policy.customerNotificationsEnabled === enabled} onClick={() => setCustomerNotificationsEnabled(enabled)} className={`rounded-md px-3 py-1.5 text-sm ${policy.customerNotificationsEnabled === enabled ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                {enabled ? 'Ativar' : 'Desativar'}
              </button>
            ))}
          </div>
        </header>
        {loading ? <div className="space-y-4 py-6"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : (
          <div className={divider}>
            <div className="border-b border-gray-100 py-5">
              <h3 className="text-sm font-semibold text-gray-900">Como avisar os responsáveis</h3>
              <p className="mt-1 text-xs text-gray-500">Escolha os canais usados nos avisos automáticos. As escolhas ficam preservadas enquanto os avisos estiverem desativados.</p>
              {policy.customerNotificationsEnabled ? <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">{channels.map(({ key, id, label }) => (
                <label key={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <Checkbox aria-label={`Canal ${label} para responsáveis`} checked={policy[key]} disabled={saving} onCheckedChange={(value) => setCustomerChannelEnabled(id, Boolean(value))} className="h-5 w-5 rounded-full" />
                  {label}
                </label>
              ))}</div> : <p className="mt-3 text-xs text-gray-400">Canais preservados enquanto os avisos automáticos estão desativados.</p>}
            </div>
            <div className="py-5"><h3 className="text-sm font-semibold text-gray-900">Quando enviar</h3><p className="mt-1 text-xs text-gray-500">Ative os avisos e ajuste os intervalos de envio.</p></div>
            {primaryRows.map(renderRow)}
            <div className="py-5"><p className="text-xs text-gray-500">A entrega de lembretes pode considerar fins de semana e feriados conforme a configuração de envio do Asaas.</p></div>
            <div className="py-5">
              <button type="button" className="flex w-full items-center justify-between text-left text-sm font-medium text-gray-800" aria-expanded={otherOpen} onClick={() => setOtherOpen((open) => !open)}>Outros avisos <span aria-hidden="true">{otherOpen ? '−' : '+'}</span></button>
              {otherOpen ? <div className={`${divider} mt-2`}>{otherRows.map(renderRow)}</div> : null}
            </div>
            <div className="py-5">
              <button type="button" className="flex w-full items-center justify-between text-left text-sm font-medium text-gray-800" aria-expanded={schoolOpen} onClick={() => setSchoolOpen((open) => !open)}>Avisos para a escola <span aria-hidden="true">{schoolOpen ? '−' : '+'}</span></button>
              {schoolOpen ? <div className={`${divider} mt-2`}>{preferences.map((preference) => {
                const timing = scheduleDescription(preference.event, preference.scheduleOffset);
                return (
                  <div key={`school-${preference.event}-${preference.scheduleOffset}`} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm text-gray-700">{eventLabels[preference.event]}</span>
                      {timing ? <><span aria-hidden="true" className="text-xs text-gray-300">·</span><span className="text-xs text-gray-500">{timing}</span></> : null}
                    </span>
                    <div className="flex gap-5">{([{ key: 'emailEnabledForProvider', label: 'E-mail' }, { key: 'smsEnabledForProvider', label: 'SMS' }] as const satisfies Array<{key: ProviderChannel; label: string}>).map(({ key, label }) => <label key={key} className="inline-flex items-center gap-2 text-sm text-gray-700"><Checkbox aria-label={`${label} — aviso para a escola`} checked={preference[key]} disabled={saving} onCheckedChange={(value) => updatePreference(preference.event, preference.scheduleOffset, { [key]: Boolean(value) })} className="h-5 w-5 rounded-full" />{label}</label>)}</div>
                  </div>
                );
              })}</div> : null}
            </div>
          </div>
        )}
        <div className="border-t border-gray-100 py-4 text-xs text-gray-500" role="status">
            {synchronization.failed > 0 ? `${synchronization.failed} sincronização(ões) falharam.` : synchronization.pending > 0 ? `${synchronization.pending} pagador(es) aguardando aplicação.` : 'Preferências salvas e sincronizadas.'}
            {synchronization.legacyPreferenceUnknown > 0 ? <p role="note" className="mt-1 max-w-2xl">{synchronization.legacyPreferenceUnknown} preferência(s) antiga(s) foram preservadas. Não há registro local que diferencie uma escolha do pagador de uma configuração anterior do Asaas; revise no cadastro do pagador antes de reativar um canal.</p> : null}
        </div>
      </section>
      <section aria-labelledby="contract-notifications-heading" className="rounded-2xl border border-gray-200 bg-white px-5 py-5 sm:px-6 sm:py-6">
        <header className="flex flex-col gap-4 border-b border-gray-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="contract-notifications-heading" className="text-base font-semibold text-gray-900">Notificações de contratos digitais</h2>
            <p className="mt-1 text-sm text-gray-500">Escolha os canais enviados automaticamente na emissão.</p>
          </div>
          <div className="inline-flex w-fit rounded-lg bg-gray-50 p-1" role="radiogroup" aria-label="Envio automático de notificações de contratos">
            {([false, true] as const).map((enabled) => (
              <button key={String(enabled)} type="button" role="radio" aria-checked={policy.contractNotificationsEnabled === enabled} disabled={saving} onClick={() => setContractNotificationsEnabled(enabled)} className={`rounded-md px-3 py-1.5 text-sm ${policy.contractNotificationsEnabled === enabled ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                {enabled ? 'Ativar' : 'Desativar'}
              </button>
            ))}
          </div>
        </header>
        <div className="pt-5">
          <h3 className="text-sm font-semibold text-gray-900">Como avisar na emissão</h3>
          <p className="mt-1 text-xs text-gray-500">As escolhas ficam preservadas enquanto o envio automático estiver desativado.</p>
          {policy.contractNotificationsEnabled ? <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {([
              ['email', 'E-mail', policy.contractEmailNotificationsEnabled],
              ['whatsapp', 'WhatsApp', policy.contractWhatsAppNotificationsEnabled],
            ] as const).map(([channel, label, checked]) => (
              <label key={channel} className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <Checkbox aria-label={`Canal ${label} para contratos digitais`} checked={checked} disabled={saving} onCheckedChange={(value) => setContractChannelEnabled(channel, Boolean(value))} className="h-5 w-5 rounded-full" />
                {label}
              </label>
            ))}
          </div> : <p className="mt-3 text-xs text-gray-400">Canais preservados enquanto o envio automático estiver desativado.</p>}
        </div>
      </section>
      <footer className="flex flex-col gap-3 border-t border-gray-100 py-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button variant="outline" disabled={!hasChanges || saving} onClick={reset}>Descartar</Button>
          <Button disabled={!hasChanges || saving} onClick={() => void savePreferences()}>{saving ? 'Salvando…' : 'Salvar e aplicar'}</Button>
        </div>
      </footer>
    </div>
  );
}
