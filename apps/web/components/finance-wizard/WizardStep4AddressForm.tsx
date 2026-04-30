'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';
import { Loader2 } from 'lucide-react';
import { maskCep } from '@alusa/lib/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { WizardState, WizardStep, WizardStep4Data } from '@alusa/finance/wizard-client';
import { wizardStep4Schema } from '@alusa/finance/wizard-client';
import { saveWizardStep4, WizardApiError } from './wizard-service';

type ViaCepResponse = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

async function lookupCep(rawCep: string) {
  const cep = rawCep.replace(/\D/g, '');
  if (cep.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) return null;
    const data = (await res.json()) as ViaCepResponse;
    if (data?.erro) return null;
    return {
      address: data?.logradouro ?? '',
      province: data?.bairro ?? '',
      addressCity: data?.localidade ?? '',
      addressState: data?.uf ?? '',
    };
  } catch {
    return null;
  }
}

type Props = {
  wizardState: WizardState;
  onComplete: (newState: WizardState, nextStep: WizardStep) => void;
  onBack: () => void;
};

export function WizardStep4AddressForm({ wizardState, onComplete, onBack }: Props) {
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const lastCepRef = useRef<string>('');
  const baseInputClasses =
    'h-10 w-full border-gray-200 bg-gray-50 px-3 text-sm font-normal transition-all focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 rounded-md placeholder:text-gray-400 text-gray-900 shadow-sm hover:bg-gray-50';

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<WizardStep4Data>({
    resolver: zodResolver(wizardStep4Schema),
    defaultValues: {
      postalCode: wizardState.postalCode ?? '',
      address: wizardState.address ?? '',
      addressNumber: wizardState.addressNumber ?? '',
      province: wizardState.province ?? '',
      addressCity: wizardState.addressCity ?? '',
      addressState: wizardState.addressState ?? '',
      complement: wizardState.complement ?? '',
    },
  });

  const onSubmit = useCallback(async (data: WizardStep4Data) => {
    try {
      setSaving(true);
      const result = await saveWizardStep4(data);
      onComplete(result.wizard, result.nextStep);
    } catch (error) {
      const message = error instanceof WizardApiError ? error.message : 'Erro ao salvar endereço.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [onComplete]);

  const postalCodeValue = watch('postalCode');

  const runCepLookup = useCallback(
    async (rawCep: string) => {
      const cepDigits = rawCep.replace(/\D/g, '');
      if (cepDigits.length !== 8) {
        toast.error('Informe um CEP válido com 8 dígitos');
        return;
      }

      if (cepDigits === lastCepRef.current && cepLoading) return;
      lastCepRef.current = cepDigits;
      setCepLoading(true);
      try {
        const result = await lookupCep(cepDigits);
        if (!result) {
          toast.error('CEP não encontrado');
          return;
        }

        if (result.address) setValue('address', result.address, { shouldDirty: true });
        if (result.province) setValue('province', result.province, { shouldDirty: true });
        if (result.addressCity) setValue('addressCity', result.addressCity, { shouldDirty: true });
        if (result.addressState) setValue('addressState', result.addressState, { shouldDirty: true });
      } finally {
        setCepLoading(false);
      }
    },
    [cepLoading, setValue],
  );

  useEffect(() => {
    const raw = (postalCodeValue || '').replace(/\D/g, '');
    if (raw.length === 8 && raw !== lastCepRef.current) {
      runCepLookup(raw);
    }
  }, [postalCodeValue, runCepLookup]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-1">
          <Label htmlFor="postalCode" className="text-sm font-medium text-gray-700">CEP *</Label>
          <Controller
            name="postalCode"
            control={control}
            render={({ field }) => (
              <Input
                id="postalCode"
                placeholder="00000-000"
                className={baseInputClasses}
                value={maskCep(field.value ?? '')}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={(e) => runCepLookup(e.currentTarget.value)}
              />
            )}
          />
          {errors.postalCode && <p className="text-xs text-red-600">{errors.postalCode.message}</p>}

          {/* botão de busca automática de CEP removido conforme solicitado */}
          {cepLoading && (
            <div className="text-[10px] text-primary/80 animate-pulse">Buscando CEP...</div>
          )}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="address" className="text-sm font-medium text-gray-700">Rua *</Label>
          <Input
            id="address"
            placeholder="Rua / Avenida"
            className={baseInputClasses}
            {...register('address')}
            disabled={cepLoading}
          />
          {errors.address && <p className="text-xs text-red-600">{errors.address.message}</p>}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="addressNumber" className="text-sm font-medium text-gray-700">Número *</Label>
          <Input
            id="addressNumber"
            placeholder="Número"
            className={baseInputClasses}
            {...register('addressNumber')}
          />
          {errors.addressNumber && <p className="text-xs text-red-600">{errors.addressNumber.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="province" className="text-sm font-medium text-gray-700">Bairro *</Label>
          <Input
            id="province"
            placeholder="Bairro"
            className={baseInputClasses}
            {...register('province')}
            disabled={cepLoading}
          />
          {errors.province && <p className="text-xs text-red-600">{errors.province.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="complement" className="text-sm font-medium text-gray-700">Complemento</Label>
          <Input
            id="complement"
            placeholder="Apto / Bloco"
            className={baseInputClasses}
            {...register('complement')}
          />
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="addressCity" className="text-sm font-medium text-gray-700">Cidade *</Label>
          <Input
            id="addressCity"
            placeholder="Cidade"
            className={baseInputClasses}
            {...register('addressCity')}
            disabled={cepLoading}
          />
          {errors.addressCity && <p className="text-xs text-red-600">{errors.addressCity.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="addressState" className="text-sm font-medium text-gray-700">Estado *</Label>
          <Input
            id="addressState"
            placeholder="UF"
            maxLength={2}
            className={baseInputClasses}
            {...register('addressState')}
            disabled={cepLoading}
          />
          {errors.addressState && <p className="text-xs text-red-600">{errors.addressState.message}</p>}
        </div>
      </div>

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
