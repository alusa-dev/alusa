'use client';

import { EVENT_PAYMENT_METHOD_LABELS, EVENT_PAYMENT_METHODS } from '@alusa/shared';
import { Info } from 'lucide-react';

import { DatePicker } from '@/components/ui/date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { FILTER_INPUT_CLASS } from '../shared/event-form-utils';
import { formatCurrencyInput } from '../shared/event-formatters';

export type ParticipantBillingMethod = '' | 'MANUAL_RECEIVED' | 'BOLETO' | 'PIX' | 'CREDIT_CARD';
export type ParticipantChargeType = 'ONE_TIME' | 'INSTALLMENT';
export type ParticipantNotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

export function ParticipantBillingFields({
  billingMethod,
  chargeType,
  feeText,
  hasEntry,
  entryText,
  onHasEntryChange,
  onEntryTextChange,
  dueDate,
  onBillingMethodChange,
  onChargeTypeChange,
  onFeeTextChange,
  onDueDateChange,
  notificationChannels,
  onNotificationChannelsChange,
  feeMultiplier = 1,
}: {
  billingMethod: ParticipantBillingMethod;
  chargeType: ParticipantChargeType;
  feeText: string;
  hasEntry: boolean;
  entryText: string;
  dueDate: Date | undefined;
  onBillingMethodChange: (value: ParticipantBillingMethod) => void;
  onChargeTypeChange: (value: ParticipantChargeType) => void;
  onFeeTextChange: (value: string) => void;
  onHasEntryChange: (value: boolean) => void;
  onEntryTextChange: (value: string) => void;
  onDueDateChange: (value: Date | undefined) => void;
  notificationChannels: ParticipantNotificationChannel[];
  onNotificationChannelsChange: (value: ParticipantNotificationChannel[]) => void;
  feeMultiplier?: number;
}) {
  const cleanFeeText = feeText.replace(/[^\d,]/g, '').replace(',', '.');
  const feePerParticipantVal = parseFloat(cleanFeeText) || 0;
  const totalFeeVal = feePerParticipantVal * feeMultiplier;
  const entryVal = parseFloat(entryText.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
  const balanceVal = Math.max(totalFeeVal - entryVal, 0);
  const installmentBaseVal = hasEntry ? balanceVal : totalFeeVal;
  const installmentOptions: Array<{ value: string; label: string }> = [];

  if (installmentBaseVal > 0) {
    for (let i = 2; i <= 12; i++) {
      const instVal = installmentBaseVal / i;
      if (instVal >= 5.0) {
        installmentOptions.push({
          value: String(i),
          label: i + 'x de R$ ' + instVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        });
      }
    }
  }

  if (installmentOptions.length === 0) {
    for (let i = 2; i <= 12; i++) {
      installmentOptions.push({ value: String(i), label: i + 'x' });
    }
  }

  return (
    <>
          <Field label={hasEntry ? 'Forma de cobrança do saldo' : 'Forma de Cobrança'}>
        <NativeSelect
          name="billingMethod"
          value={billingMethod || undefined}
          placeholder="Selecione a forma de cobrança"
          required
          onValueChange={(value) => {
            const nextValue = value as ParticipantBillingMethod;
            onBillingMethodChange(nextValue);
            if (nextValue === 'MANUAL_RECEIVED') onHasEntryChange(false);
            if (nextValue === 'PIX' || nextValue === 'MANUAL_RECEIVED') onChargeTypeChange('ONE_TIME');
          }}
          options={[
            ...(!hasEntry ? [{ value: 'MANUAL_RECEIVED', label: 'Quitado na hora (Manual)' }] : []),
            { value: 'BOLETO', label: 'Boleto' },
            ...(!hasEntry ? [{ value: 'PIX', label: 'Pix' }] : []),
            { value: 'CREDIT_CARD', label: 'Cartão de Crédito' },
          ]}
        />
      </Field>

      {billingMethod && (
        <div className="space-y-4">
          <Field label="Taxa de inscrição cobrada">
            <div className="relative flex items-center">
              <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">R$</span>
              <Input
                name="registrationFeeCharged"
                type="text"
                value={feeText}
                onChange={(event) => onFeeTextChange(formatCurrencyInput(event.target.value))}
                className={cn(FILTER_INPUT_CLASS, 'pl-10 text-right')}
                required
              />
            </div>
            {feeMultiplier > 1 && (
              <p className="mt-1 text-xs text-slate-500">
                Total para {feeMultiplier} alunos: <strong className="text-slate-700">R$ {totalFeeVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </p>
            )}
          </Field>

          <input type="hidden" name="hasEntry" value={hasEntry ? 'true' : 'false'} />
          {billingMethod !== 'MANUAL_RECEIVED' && (
            <div className="flex items-center gap-2 py-1">
              <Checkbox
                id="event-has-entry"
                checked={hasEntry}
                onCheckedChange={(checked) => {
                  onHasEntryChange(checked);
                  if (checked) {
                    onBillingMethodChange(['BOLETO', 'CREDIT_CARD'].includes(billingMethod) ? billingMethod : 'BOLETO');
                    onChargeTypeChange('INSTALLMENT');
                  }
                }}
              />
              <label htmlFor="event-has-entry" className="cursor-pointer text-sm font-medium text-slate-700">
                Possui entrada?
              </label>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Sobre a entrada"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      <Info className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs text-left leading-relaxed">
                    Registre uma parte agora e parcele apenas o saldo.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}

          {hasEntry && (
            <div className="space-y-4 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
              <Field label="Valor da entrada">
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-3 text-xs font-semibold text-slate-400">R$</span>
                  <Input
                    name="entryAmount"
                    type="text"
                    value={entryText}
                    onChange={(event) => onEntryTextChange(formatCurrencyInput(event.target.value))}
                    className={cn(FILTER_INPUT_CLASS, 'pl-10 text-right')}
                    required
                  />
                </div>
              </Field>

              <Field label="Forma de recebimento da entrada">
                <NativeSelect
                  name="entryPaymentMethod"
                  defaultValue="CASH"
                  required
                  options={EVENT_PAYMENT_METHODS.filter((method) => method !== 'COMPLIMENTARY').map((method) => ({
                    value: method,
                    label: EVENT_PAYMENT_METHOD_LABELS[method],
                  }))}
                />
              </Field>

              <div className="flex items-center justify-between border-t border-violet-100 pt-3 text-sm">
                <span className="text-slate-600">Saldo a parcelar</span>
                <strong className="text-slate-900">R$ {balanceVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </div>
            </div>
          )}

          <input type="hidden" name="isManual" value={billingMethod === 'MANUAL_RECEIVED' ? 'true' : 'false'} />
          {billingMethod === 'MANUAL_RECEIVED' && !hasEntry && (
            <Field label="Forma de recebimento">
              <NativeSelect
                name="feePaymentMethod"
                defaultValue="MANUAL_PIX"
                options={EVENT_PAYMENT_METHODS.filter((method) => method !== 'COMPLIMENTARY').map((method) => ({
                  value: method,
                  label: EVENT_PAYMENT_METHOD_LABELS[method],
                }))}
              />
            </Field>
          )}

          {billingMethod !== 'MANUAL_RECEIVED' && (
            <>
              <Field label="Tipo de cobrança">
                <NativeSelect
                  name="chargeType"
                  value={hasEntry ? 'INSTALLMENT' : billingMethod === 'PIX' ? 'ONE_TIME' : chargeType}
                  onValueChange={(value) => onChargeTypeChange(value as ParticipantChargeType)}
                  options={
                    hasEntry
                      ? [{ value: 'INSTALLMENT', label: 'Parcelado' }]
                      : billingMethod === 'PIX'
                      ? [{ value: 'ONE_TIME', label: 'À vista' }]
                      : [
                          { value: 'ONE_TIME', label: 'À vista' },
                          { value: 'INSTALLMENT', label: 'Parcelado' },
                        ]
                  }
                />
              </Field>

              <Field label="Vencimento da primeira cobrança">
                <input type="hidden" name="dueDate" value={dueDate ? dueDate.toISOString().split('T')[0] : ''} />
                <DatePicker
                  value={dueDate}
                  onChange={onDueDateChange}
                  variant="input"
                  placeholder="dd/mm/aaaa"
                  className={FILTER_INPUT_CLASS}
                  readOnlyInput
                />
              </Field>

              {(chargeType === 'INSTALLMENT' || hasEntry) && billingMethod !== 'PIX' && (
                <Field label="Quantidade de parcelas">
                  <NativeSelect name="installmentCount" defaultValue="2" options={installmentOptions} />
                </Field>
              )}
            </>
          )}

          {billingMethod !== 'MANUAL_RECEIVED' && (
            <Field label="Canais de notificação">
              <div className="flex flex-wrap gap-2">
                {(['WHATSAPP', 'EMAIL', 'SMS'] as const).map((channel) => {
                  const active = notificationChannels.includes(channel);
                  return (
                    <button
                      key={channel}
                      type="button"
                      onClick={() =>
                        onNotificationChannelsChange(
                          active
                            ? notificationChannels.filter((item) => item !== channel)
                            : [...notificationChannels, channel],
                        )
                      }
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm font-medium transition',
                        active
                          ? 'border-brand-accent bg-brand-accent text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {channel === 'WHATSAPP' ? 'WhatsApp' : channel === 'EMAIL' ? 'E-mail' : 'SMS'}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-slate-500">A seleção feita aqui prevalece sobre os padrões da conta.</p>
            </Field>
          )}
        </div>
      )}
    </>
  );
}
