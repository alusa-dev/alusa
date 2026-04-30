'use client';

import React, { useCallback, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';
import { Loader2 } from 'lucide-react';
import { maskPhone } from '@alusa/lib/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { WizardState, WizardStep, WizardStep3Data } from '@alusa/finance/wizard-client';
import { wizardStep3Schema } from '@alusa/finance/wizard-client';
import { saveWizardStep3, WizardApiError } from './wizard-service';

type Props = {
  wizardState: WizardState;
  onComplete: (newState: WizardState, nextStep: WizardStep) => void;
  onBack: () => void;
};

export function WizardStep3ContactForm({ wizardState, onComplete, onBack }: Props) {
  const [saving, setSaving] = useState(false);
  const baseInputClasses =
    'h-10 w-full border-gray-200 bg-gray-50 px-3 text-sm font-normal transition-all focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 rounded-md placeholder:text-gray-400 text-gray-900 shadow-sm hover:bg-gray-50';

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<WizardStep3Data>({
    resolver: zodResolver(wizardStep3Schema),
    defaultValues: {
      mobilePhone: wizardState.mobilePhone ?? '',
      landlinePhone: wizardState.landlinePhone ?? '',
    },
  });

  const onSubmit = useCallback(async (data: WizardStep3Data) => {
    try {
      setSaving(true);
      const result = await saveWizardStep3(data);
      onComplete(result.wizard, result.nextStep);
    } catch (error) {
      const message = error instanceof WizardApiError ? error.message : 'Erro ao salvar contato.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [onComplete]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mobilePhone" className="text-sm font-medium text-gray-700">Telefone celular *</Label>
          <Controller
            name="mobilePhone"
            control={control}
            render={({ field }) => (
              <Input
                id="mobilePhone"
                placeholder="(00) 00000-0000"
                className={baseInputClasses}
                value={maskPhone(field.value ?? '')}
                onChange={(e) => field.onChange(e.target.value)}
              />
            )}
          />
          {errors.mobilePhone && <p className="text-xs text-red-600">{errors.mobilePhone.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="landlinePhone" className="text-sm font-medium text-gray-700">Telefone fixo (opcional)</Label>
          <Controller
            name="landlinePhone"
            control={control}
            render={({ field }) => (
              <Input
                id="landlinePhone"
                placeholder="(00) 0000-0000"
                className={baseInputClasses}
                value={maskPhone(field.value ?? '')}
                onChange={(e) => field.onChange(e.target.value)}
              />
            )}
          />
          {errors.landlinePhone && <p className="text-xs text-red-600">{errors.landlinePhone.message}</p>}
        </div>
      </div>

      {/* aviso removido conforme solicitado */}

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
