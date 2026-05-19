'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { WizardState, WizardStep, WizardStep5Data } from '@alusa/finance/wizard-client';
import { wizardStep5Schema } from '@alusa/finance/wizard-client';
import { saveWizardStep5, WizardApiError } from './wizard-service';
import { InfoCallout } from '@/components/ui/info-callout';

function parseCurrencyBRLToCents(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits);
}

type Props = {
  wizardState: WizardState;
  onComplete: (newState: WizardState, nextStep: WizardStep) => void;
  onBack: () => void;
};

export function WizardStep5FinancialForm({ wizardState, onComplete, onBack }: Props) {
  const [saving, setSaving] = useState(false);
  const baseInputClasses =
    'h-10 w-full border-gray-200 bg-gray-50 px-3 text-sm font-normal transition-all focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 rounded-md placeholder:text-gray-400 text-gray-900 shadow-sm hover:bg-gray-50';

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<WizardStep5Data>({
    resolver: zodResolver(wizardStep5Schema),
    defaultValues: {
      incomeValue: wizardState.incomeValue ?? undefined,
    },
  });

  const onSubmit = useCallback(async (data: WizardStep5Data) => {
    try {
      setSaving(true);
      const result = await saveWizardStep5({ incomeValue: data.incomeValue });
      onComplete(result.wizard, result.nextStep);
    } catch (error) {
      const message = error instanceof WizardApiError ? error.message : 'Erro ao salvar faturamento.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [onComplete]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col gap-6">
      <div className="space-y-2">
        <Label htmlFor="incomeValue" className="text-sm font-medium text-gray-700">Faturamento mensal (R$) *</Label>
        <Controller
          name="incomeValue"
          control={control}
          render={({ field }) => {
            const value = field.value;
            const displayValue =
              value === undefined || value === null ? '' : currencyFormatter.format(value);

            return (
              <Input
                id="incomeValue"
                type="text"
                inputMode="numeric"
                placeholder={currencyFormatter.format(0)}
                className={baseInputClasses}
                value={displayValue}
                onChange={(e) => {
                  const cents = parseCurrencyBRLToCents(e.target.value);
                  if (cents === null) {
                    field.onChange(undefined);
                    return;
                  }
                  field.onChange(cents / 100);
                }}
              />
            );
          }}
        />
        {errors.incomeValue && <p className="text-xs text-red-600">{errors.incomeValue.message}</p>}
      </div>

      <InfoCallout title="Informativo" size="md" showIcon={false}>
        Esse dado é utilizado apenas para calibração de limites e não representa validação bancária.
      </InfoCallout>

      <div className="absolute bottom-0 left-0 w-full px-8 pb-8 pt-6 flex justify-between bg-white z-10 rounded-b-2xl">
        <Button 
          variant="outline" 
          type="button" 
          onClick={onBack} 
          disabled={saving}
          className="h-10 px-6 text-sm border-gray-200 hover:bg-gray-50 hover:text-gray-900"
        >
          Voltar
        </Button>
        <Button 
          type="submit" 
          disabled={saving}
          className="h-10 px-8 text-sm shadow-sm hover:shadow-md transition-all"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            'Continuar'
          )}
        </Button>
      </div>
    </form>
  );
}
