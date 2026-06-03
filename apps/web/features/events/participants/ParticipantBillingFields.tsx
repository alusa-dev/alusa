'use client';

import { EVENT_PAYMENT_METHOD_LABELS, EVENT_PAYMENT_METHODS } from '@alusa/shared';

import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { FILTER_INPUT_CLASS } from '../shared/event-form-utils';
import { formatCurrencyInput } from '../shared/event-formatters';

export type ParticipantBillingMethod = '' | 'MANUAL_RECEIVED' | 'BOLETO' | 'PIX' | 'CREDIT_CARD';
export type ParticipantChargeType = 'ONE_TIME' | 'INSTALLMENT';

export function ParticipantBillingFields({
  billingMethod,
  chargeType,
  feeText,
  dueDate,
  onBillingMethodChange,
  onChargeTypeChange,
  onFeeTextChange,
  onDueDateChange,
}: {
  billingMethod: ParticipantBillingMethod;
  chargeType: ParticipantChargeType;
  feeText: string;
  dueDate: Date | undefined;
  onBillingMethodChange: (value: ParticipantBillingMethod) => void;
  onChargeTypeChange: (value: ParticipantChargeType) => void;
  onFeeTextChange: (value: string) => void;
  onDueDateChange: (value: Date | undefined) => void;
}) {
  const cleanFeeText = feeText.replace(/[^\d,]/g, '').replace(',', '.');
  const totalFeeVal = parseFloat(cleanFeeText) || 0;
  const installmentOptions: Array<{ value: string; label: string }> = [];

  if (totalFeeVal > 0) {
    for (let i = 2; i <= 12; i++) {
      const instVal = totalFeeVal / i;
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
      <Field label="Forma de Cobrança">
        <NativeSelect
          name="billingMethod"
          placeholder="Selecione a forma de cobrança"
          required
          onValueChange={(value) => {
            const nextValue = value as ParticipantBillingMethod;
            onBillingMethodChange(nextValue);
            if (nextValue === 'PIX') onChargeTypeChange('ONE_TIME');
          }}
          options={[
            { value: 'MANUAL_RECEIVED', label: 'Quitado na hora (Manual)' },
            { value: 'BOLETO', label: 'Boleto' },
            { value: 'PIX', label: 'Pix' },
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
          </Field>

          <input type="hidden" name="isManual" value={billingMethod === 'MANUAL_RECEIVED' ? 'true' : 'false'} />
          {billingMethod === 'MANUAL_RECEIVED' && (
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
                  defaultValue={billingMethod === 'PIX' ? 'ONE_TIME' : chargeType}
                  onValueChange={(value) => onChargeTypeChange(value as ParticipantChargeType)}
                  options={
                    billingMethod === 'PIX'
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

              {chargeType === 'INSTALLMENT' && billingMethod !== 'PIX' && (
                <Field label="Quantidade de parcelas">
                  <NativeSelect name="installmentCount" defaultValue="2" options={installmentOptions} />
                </Field>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
