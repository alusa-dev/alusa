'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';
import { Loader2 } from 'lucide-react';
import { maskCpfCnpj } from '@alusa/lib/client';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { WizardState, WizardStep, WizardStep2Data } from '@alusa/finance/wizard-client';
import { wizardStep2Schema } from '@alusa/finance/wizard-client';
import { saveWizardStep2, WizardApiError } from './wizard-service';

type Props = {
  wizardState: WizardState;
  onComplete: (newState: WizardState, nextStep: WizardStep) => void;
  onBack: () => void;
};

const companyTypes = [
  { value: 'MEI', label: 'MEI - Microempreendedor Individual' },
  { value: 'LIMITED', label: 'LTDA - Sociedade Limitada' },
  { value: 'INDIVIDUAL', label: 'EI - Empresário Individual' },
  { value: 'ASSOCIATION', label: 'Associação' },
];

export function WizardStep2IdentificationForm({ wizardState, onComplete, onBack }: Props) {
  const personType = wizardState.personType ?? 'PF';
  const schema = useMemo(() => wizardStep2Schema, []);
  const [saving, setSaving] = useState(false);
  const baseInputClasses =
    'h-10 w-full border-gray-200 bg-gray-50 px-3 text-sm font-normal transition-all focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 rounded-md placeholder:text-gray-400 text-gray-900 shadow-sm hover:bg-gray-50';

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<WizardStep2Data>({
    resolver: zodResolver(schema),
    defaultValues: {
      personType,
      schoolName: wizardState.schoolName ?? '',
      ownerName: wizardState.ownerName ?? '',
      companyName: wizardState.companyName ?? '',
      cpfCnpj: wizardState.cpfCnpj ?? '',
      birthDate: wizardState.birthDate ?? '',
      companyType: wizardState.companyType ?? undefined,
    } as WizardStep2Data,
  });

  const onSubmit = useCallback(
    async (data: WizardStep2Data) => {
      try {
        setSaving(true);
        const result = await saveWizardStep2(data);
        onComplete(result.wizard, result.nextStep);
      } catch (error) {
        const message =
          error instanceof WizardApiError ? error.message : 'Erro ao salvar identificação.';
        toast.error(message);
      } finally {
        setSaving(false);
      }
    },
    [onComplete],
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col gap-6">
      <input type="hidden" {...register('personType')} />
      {personType === 'PF' ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="schoolName" className="text-sm font-medium text-gray-700">
              Nome da escola *
            </Label>
            <Input
              id="schoolName"
              placeholder="Digite o nome da escola"
              className={baseInputClasses}
              {...register('schoolName')}
            />
            {errors.schoolName && (
              <p className="text-xs text-red-600">{errors.schoolName.message}</p>
            )}
          </div>

          <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="ownerName" className="text-sm font-medium text-gray-700">
              Nome completo *
            </Label>
            <Input
              id="ownerName"
              placeholder="Digite seu nome"
              className={baseInputClasses}
              {...register('ownerName')}
            />
            {errors.ownerName && <p className="text-xs text-red-600">{errors.ownerName.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cpfCnpj" className="text-sm font-medium text-gray-700">
              CPF *
            </Label>
            <Controller
              name="cpfCnpj"
              control={control}
              render={({ field }) => (
                <Input
                  id="cpfCnpj"
                  placeholder="000.000.000-00"
                  className={baseInputClasses}
                  value={maskCpfCnpj(field.value ?? '')}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            />
            {errors.cpfCnpj && <p className="text-xs text-red-600">{errors.cpfCnpj.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="birthDate" className="text-sm font-medium text-gray-700">
              Data de nascimento *
            </Label>
            <Controller
              name="birthDate"
              control={control}
              render={({ field }) => (
                <DatePicker
                  id="birthDate"
                  value={field.value ? new Date(field.value + 'T00:00:00') : undefined}
                  onChange={(date) => {
                    if (!date) {
                      field.onChange('');
                      return;
                    }
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    field.onChange(`${year}-${month}-${day}`);
                  }}
                  className={cn(baseInputClasses, !field.value && 'text-gray-400 font-normal')}
                  placeholder="Selecione uma data"
                  variant="input"
                  fromYear={1900}
                  toYear={new Date().getFullYear()}
                />
              )}
            />
            {errors.birthDate && <p className="text-xs text-red-600">{errors.birthDate.message}</p>}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="schoolName" className="text-sm font-medium text-gray-700">
              Nome da escola *
            </Label>
            <Input
              id="schoolName"
              placeholder="Digite o nome da escola"
              className={baseInputClasses}
              {...register('schoolName')}
            />
            {errors.schoolName && (
              <p className="text-xs text-red-600">{errors.schoolName.message}</p>
            )}
          </div>

          <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="companyName" className="text-sm font-medium text-gray-700">
              Razão social *
            </Label>
            <Input
              id="companyName"
              placeholder="Digite a razão social"
              className={baseInputClasses}
              {...register('companyName')}
            />
            {errors.companyName && (
              <p className="text-xs text-red-600">{errors.companyName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cpfCnpj" className="text-sm font-medium text-gray-700">
              CNPJ *
            </Label>
            <Controller
              name="cpfCnpj"
              control={control}
              render={({ field }) => (
                <Input
                  id="cpfCnpj"
                  placeholder="00.000.000/0000-00"
                  className={baseInputClasses}
                  value={maskCpfCnpj(field.value ?? '')}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              )}
            />
            {errors.cpfCnpj && <p className="text-xs text-red-600">{errors.cpfCnpj.message}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Tipo de empresa *</Label>
            <Controller
              name="companyType"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className={baseInputClasses}>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {companyTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.companyType && (
              <p className="text-xs text-red-600">{errors.companyType.message}</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-auto absolute bottom-0 left-0 w-full px-8 pb-8 pt-6 flex justify-between bg-white z-10 rounded-b-2xl">
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
