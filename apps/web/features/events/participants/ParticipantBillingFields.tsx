'use client';

import { EVENT_PAYMENT_METHOD_LABELS, EVENT_PAYMENT_METHODS } from '@alusa/shared';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { FILTER_INPUT_CLASS } from '../shared/event-form-utils';
import { formatCurrencyInput } from '../shared/event-formatters';

export type ParticipantBillingMethod = '' | 'MANUAL_RECEIVED' | 'EXEMPT' | 'ISSUE_CHARGE' | 'BOLETO' | 'PIX' | 'CREDIT_CARD';
export type ParticipantChargeType = 'ONE_TIME' | 'INSTALLMENT';
export type ParticipantNotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type ParticipantDiscountType = 'FIXED' | 'PERCENTAGE';

export function ParticipantBillingFields({
  billingMethod,
  chargeType,
  feeText,
  discountType = 'FIXED',
  discountText = '',
  hasEntry,
  entryText,
  onHasEntryChange,
  onEntryTextChange,
  dueDate,
  onBillingMethodChange,
  onChargeTypeChange,
  onFeeTextChange,
  onDiscountTypeChange,
  onDiscountTextChange,
  onDueDateChange,
  notificationChannels,
  onNotificationChannelsChange,
  feeMultiplier = 1,
  showManualDiscount = false,
  useBillingModeSelection = false,
  chargePaymentMethod = '',
  onChargePaymentMethodChange,
  notificationCallout,
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
  discountType?: ParticipantDiscountType;
  discountText?: string;
  onDiscountTypeChange?: (value: ParticipantDiscountType) => void;
  onDiscountTextChange?: (value: string) => void;
  showManualDiscount?: boolean;
  useBillingModeSelection?: boolean;
  chargePaymentMethod?: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | '';
  onChargePaymentMethodChange?: (value: 'BOLETO' | 'PIX' | 'CREDIT_CARD') => void;
  notificationCallout?: ReactNode;
}) {
  const isManualBilling = billingMethod === 'MANUAL_RECEIVED' || billingMethod === 'EXEMPT';
  const effectiveBillingMethod = useBillingModeSelection && billingMethod === 'ISSUE_CHARGE'
    ? chargePaymentMethod
    : billingMethod;
  const cleanFeeText = feeText.replace(/[^\d,]/g, '').replace(',', '.');
  const feePerParticipantVal = parseFloat(cleanFeeText) || 0;
  const totalFeeVal = feePerParticipantVal * feeMultiplier;
  const discountInputVal = discountType === 'FIXED'
    ? parseFloat(discountText.replace(/[^\d,]/g, '').replace(',', '.')) || 0
    : parseFloat(discountText.replace(',', '.')) || 0;
  const discountAmountVal = discountType === 'PERCENTAGE'
    ? Math.min(totalFeeVal, totalFeeVal * (discountInputVal / 100))
    : Math.min(totalFeeVal, discountInputVal);
  const chargedTotalVal = Math.max(totalFeeVal - discountAmountVal, 0);
  const entryVal = parseFloat(entryText.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
  const balanceVal = Math.max(totalFeeVal - entryVal, 0);
  const installmentBaseVal = hasEntry ? balanceVal : chargedTotalVal;
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
          <Field label={hasEntry ? 'Forma de cobrança do saldo' : useBillingModeSelection ? 'Como será pago?' : 'Forma de Cobrança'}>
        <NativeSelect
          name="billingMethod"
          value={billingMethod || undefined}
          placeholder="Selecione a forma de cobrança"
          required
          onValueChange={(value) => {
            const nextValue = value as ParticipantBillingMethod;
            onBillingMethodChange(nextValue);
            if (nextValue === 'MANUAL_RECEIVED' || nextValue === 'EXEMPT') onHasEntryChange(false);
            if (nextValue === 'ISSUE_CHARGE') {
              onChargePaymentMethodChange?.(chargePaymentMethod || 'BOLETO');
            }
            if (nextValue === 'PIX' || nextValue === 'MANUAL_RECEIVED') onChargeTypeChange('ONE_TIME');
          }}
          options={useBillingModeSelection
            ? [
                ...(!hasEntry ? [{ value: 'MANUAL_RECEIVED', label: 'Quitado na hora (Manual)' }] : []),
                ...(!hasEntry ? [{ value: 'EXEMPT', label: 'Isento' }] : []),
                { value: 'ISSUE_CHARGE', label: 'Emitir cobrança' },
              ]
            : [
                ...(!hasEntry ? [{ value: 'MANUAL_RECEIVED', label: 'Quitado na hora (Manual)' }] : []),
                ...(!hasEntry ? [{ value: 'EXEMPT', label: 'Isento' }] : []),
                { value: 'BOLETO', label: 'Boleto' },
                ...(!hasEntry ? [{ value: 'PIX', label: 'Pix' }] : []),
                { value: 'CREDIT_CARD', label: 'Cartão de Crédito' },
              ]}
        />
      </Field>

      {useBillingModeSelection && billingMethod === 'ISSUE_CHARGE' && (
        <Field label="Meio de pagamento da cobrança">
          <NativeSelect
            name="chargePaymentMethod"
            value={chargePaymentMethod || undefined}
            placeholder="Selecione o meio de pagamento"
            required
            onValueChange={(value) => {
              const nextValue = value as 'BOLETO' | 'PIX' | 'CREDIT_CARD';
              onChargePaymentMethodChange?.(nextValue);
              if (nextValue === 'PIX') onChargeTypeChange('ONE_TIME');
            }}
            options={[
              { value: 'BOLETO', label: 'Boleto' },
              { value: 'PIX', label: 'Pix' },
              { value: 'CREDIT_CARD', label: 'Cartão de Crédito' },
            ]}
          />
        </Field>
      )}

      {billingMethod && (!useBillingModeSelection || billingMethod !== 'ISSUE_CHARGE' || chargePaymentMethod) && (
        <div className="space-y-4">
          {billingMethod === 'EXEMPT' ? (
            <input type="hidden" name="registrationFeeOriginal" value={feeText} />
          ) : (
            <Field label="Valor original da inscrição">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">R$</span>
                <Input
                  name="registrationFeeOriginal"
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
          )}

          {showManualDiscount && (isManualBilling || billingMethod === 'ISSUE_CHARGE') && billingMethod !== 'EXEMPT' && !hasEntry && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Field label="Desconto concedido">
                <input type="hidden" name="discountType" value={discountType} />
                <div className="flex items-center gap-2">
                  <Tabs
                    value={discountType}
                    onValueChange={(value) => onDiscountTypeChange?.(value as ParticipantDiscountType)}
                    aria-label="Tipo de desconto"
                    className="shrink-0"
                  >
                    <TabsList className="h-10 rounded-xl bg-slate-100/80 p-1">
                      <TabsTrigger value="PERCENTAGE" className="h-8 rounded-lg px-3 py-0 text-sm shadow-none" aria-label="Desconto percentual">%</TabsTrigger>
                      <TabsTrigger value="FIXED" className="h-8 rounded-lg px-3 py-0 text-sm shadow-none" aria-label="Desconto em valor fixo">R$</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Input
                    name="discountValue"
                    type="text"
                    value={discountText}
                    onChange={(event) => onDiscountTextChange?.(
                      discountType === 'FIXED' ? formatCurrencyInput(event.target.value) : event.target.value.replace(/[^\d,.]/g, ''),
                    )}
                    className={cn(FILTER_INPUT_CLASS, 'flex-1 text-right')}
                    placeholder={discountType === 'FIXED' ? '0,00' : '0,00'}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                  <span className="flex flex-col">
                    <span>Valor final para cobrança</span>
                    {feeMultiplier > 1 && (
                      <span className="mt-0.5 text-[11px] text-slate-500">
                        Desconto aplicado sobre o total dos {feeMultiplier} alunos
                      </span>
                    )}
                  </span>
                  <strong className="text-slate-900">R$ {chargedTotalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
              </Field>
            </div>
          )}

          <input type="hidden" name="hasEntry" value={hasEntry ? 'true' : 'false'} />
          {!isManualBilling && (
            <div className="flex items-center gap-2 py-1">
              <Checkbox
                id="event-has-entry"
                checked={hasEntry}
                onCheckedChange={(checked) => {
                  onHasEntryChange(checked);
                  if (checked) {
                    if (useBillingModeSelection) {
                      onBillingMethodChange('ISSUE_CHARGE');
                      onChargePaymentMethodChange?.(chargePaymentMethod === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BOLETO');
                    } else {
                      onBillingMethodChange(['BOLETO', 'CREDIT_CARD'].includes(billingMethod) ? billingMethod : 'BOLETO');
                    }
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

          <input type="hidden" name="isManual" value={isManualBilling ? 'true' : 'false'} />
          {isManualBilling && billingMethod !== 'EXEMPT' && !hasEntry && (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Field label="Valor recebido agora">
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute left-3 text-xs font-semibold text-slate-400">R$</span>
                  <Input
                    name="initialPaymentAmount"
                    type="text"
                    value={entryText}
                    onChange={(event) => onEntryTextChange(formatCurrencyInput(event.target.value))}
                    className={cn(FILTER_INPUT_CLASS, 'pl-10 text-right')}
                    placeholder="0,00"
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">Informe zero caso o aluno ainda não tenha pago.</p>
              </Field>
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
            </div>
          )}

          {!isManualBilling && (
            <>
              <Field label="Tipo de cobrança">
                <NativeSelect
                  name="chargeType"
                  value={hasEntry ? 'INSTALLMENT' : effectiveBillingMethod === 'PIX' ? 'ONE_TIME' : chargeType}
                  onValueChange={(value) => onChargeTypeChange(value as ParticipantChargeType)}
                  options={
                    hasEntry
                      ? [{ value: 'INSTALLMENT', label: 'Parcelado' }]
                    : effectiveBillingMethod === 'PIX'
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

          {!isManualBilling && (
            <div className="grid gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-slate-600">Canais de notificação</span>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Sobre os canais de notificação"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                      >
                        <Info className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-left leading-relaxed">
                      A seleção feita aqui prevalece sobre os padrões da conta.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
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
            </div>
          )}
          {notificationCallout}
        </div>
      )}
    </>
  );
}
