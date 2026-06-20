'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { findCEP } from '@/lib/cep';
import { cn } from '@/lib/utils';

export type ResponsavelEnderecoValue = {
  enderecoCep: string;
  enderecoLogradouro: string;
  enderecoNumero: string;
  enderecoComplemento: string;
  enderecoBairro: string;
  enderecoCidade: string;
  enderecoUf: string;
};

export const emptyResponsavelEnderecoValue: ResponsavelEnderecoValue = {
  enderecoCep: '',
  enderecoLogradouro: '',
  enderecoNumero: '',
  enderecoComplemento: '',
  enderecoBairro: '',
  enderecoCidade: '',
  enderecoUf: '',
};

type ResponsavelEnderecoFieldsProps = {
  value: ResponsavelEnderecoValue;
  onChange: (_value: ResponsavelEnderecoValue) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
  onLookupError?: (_message: string) => void;
};

function formatCep(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function ResponsavelEnderecoFields({
  value,
  onChange,
  disabled = false,
  required = true,
  className,
  inputClassName,
  labelClassName = 'text-xs font-medium text-slate-600',
  onLookupError,
}: ResponsavelEnderecoFieldsProps) {
  const [loading, setLoading] = useState(false);
  const lastCepRef = useRef('');

  const updateField = useCallback(
    <K extends keyof ResponsavelEnderecoValue>(field: K, next: ResponsavelEnderecoValue[K]) => {
      onChange({ ...value, [field]: next });
    },
    [onChange, value],
  );

  const runCepLookup = useCallback(
    async (rawCep: string) => {
      const cep = rawCep.replace(/\D/g, '');
      if (cep.length !== 8) {
        onLookupError?.('Informe um CEP válido com 8 dígitos');
        return;
      }
      if (cep === lastCepRef.current && loading) return;
      lastCepRef.current = cep;
      setLoading(true);
      try {
        const result = await findCEP(cep);
        onChange({
          ...value,
          enderecoCep: formatCep(result.cep),
          enderecoLogradouro: result.logradouro ?? value.enderecoLogradouro,
          enderecoBairro: result.bairro ?? value.enderecoBairro,
          enderecoCidade: result.cidade ?? value.enderecoCidade,
          enderecoUf: result.uf ?? value.enderecoUf,
        });
      } catch {
        onLookupError?.('CEP não encontrado. Preencha o endereço manualmente.');
      } finally {
        setLoading(false);
      }
    },
    [loading, onChange, onLookupError, value],
  );

  useEffect(() => {
    const raw = (value.enderecoCep || '').replace(/\D/g, '');
    if (raw.length === 8 && raw !== lastCepRef.current) {
      void runCepLookup(raw);
    }
  }, [value.enderecoCep, runCepLookup]);

  const fieldClass = cn(
    'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700',
    inputClassName,
  );

  return (
    <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-4', className)}>
      <div>
        <label className={labelClassName} htmlFor="resp-endereco-cep">
          CEP{required ? ' *' : ''}
        </label>
        <Input
          id="resp-endereco-cep"
          value={value.enderecoCep}
          onChange={(event) => updateField('enderecoCep', formatCep(event.target.value))}
          onBlur={(event) => void runCepLookup(event.currentTarget.value)}
          placeholder="00000-000"
          disabled={disabled || loading}
          className={fieldClass}
        />
        <button
          type="button"
          className="mt-1 text-[11px] text-violet-600 hover:text-violet-700 disabled:opacity-60"
          onClick={() => void runCepLookup(value.enderecoCep)}
          disabled={disabled || loading}
        >
          Buscar CEP automaticamente
        </button>
      </div>
      <div className="md:col-span-2">
        <label className={labelClassName} htmlFor="resp-endereco-logradouro">
          Endereço{required ? ' *' : ''}
        </label>
        <Input
          id="resp-endereco-logradouro"
          value={value.enderecoLogradouro}
          onChange={(event) => updateField('enderecoLogradouro', event.target.value)}
          placeholder="Rua/Av."
          disabled={disabled || loading}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClassName} htmlFor="resp-endereco-numero">
          Número{required ? ' *' : ''}
        </label>
        <Input
          id="resp-endereco-numero"
          value={value.enderecoNumero}
          onChange={(event) => updateField('enderecoNumero', event.target.value)}
          placeholder="Nº"
          disabled={disabled || loading}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClassName} htmlFor="resp-endereco-complemento">
          Complemento
        </label>
        <Input
          id="resp-endereco-complemento"
          value={value.enderecoComplemento}
          onChange={(event) => updateField('enderecoComplemento', event.target.value)}
          placeholder="Apto, bloco"
          disabled={disabled || loading}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClassName} htmlFor="resp-endereco-bairro">
          Bairro{required ? ' *' : ''}
        </label>
        <Input
          id="resp-endereco-bairro"
          value={value.enderecoBairro}
          onChange={(event) => updateField('enderecoBairro', event.target.value)}
          placeholder="Bairro"
          disabled={disabled || loading}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClassName} htmlFor="resp-endereco-cidade">
          Cidade{required ? ' *' : ''}
        </label>
        <Input
          id="resp-endereco-cidade"
          value={value.enderecoCidade}
          onChange={(event) => updateField('enderecoCidade', event.target.value)}
          placeholder="Cidade"
          disabled={disabled || loading}
          className={fieldClass}
        />
      </div>
      <div>
        <label className={labelClassName} htmlFor="resp-endereco-uf">
          UF{required ? ' *' : ''}
        </label>
        <Input
          id="resp-endereco-uf"
          value={value.enderecoUf}
          onChange={(event) => updateField('enderecoUf', event.target.value.toUpperCase().slice(0, 2))}
          placeholder="UF"
          maxLength={2}
          disabled={disabled || loading}
          className={fieldClass}
        />
      </div>
    </div>
  );
}

export function enderecoValueFromDetail(detail?: {
  endereco?: {
    cep?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
  };
}): ResponsavelEnderecoValue {
  return {
    enderecoCep: detail?.endereco?.cep ?? '',
    enderecoLogradouro: detail?.endereco?.logradouro ?? '',
    enderecoNumero: detail?.endereco?.numero ?? '',
    enderecoComplemento: detail?.endereco?.complemento ?? '',
    enderecoBairro: detail?.endereco?.bairro ?? '',
    enderecoCidade: detail?.endereco?.cidade ?? '',
    enderecoUf: detail?.endereco?.uf ?? '',
  };
}

export function enderecoValueToPayload(value: ResponsavelEnderecoValue) {
  return {
    cep: value.enderecoCep.replace(/\D/g, ''),
    logradouro: value.enderecoLogradouro.trim(),
    numero: value.enderecoNumero.trim(),
    complemento: value.enderecoComplemento.trim() || undefined,
    bairro: value.enderecoBairro.trim(),
    cidade: value.enderecoCidade.trim(),
    uf: value.enderecoUf.trim().toUpperCase(),
  };
}
