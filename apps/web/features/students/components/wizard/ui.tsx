'use client';
import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { IMaskInput } from 'react-imask';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { wizardFieldInputClass } from '@/components/shared/wizard/field-styles';
import {
  FieldLabel,
  WizardErrorVisibilityProvider,
  WizardInput,
  WizardFieldError,
  useWizardErrorsVisible,
  useWizardFieldClass,
} from '@/components/shared/wizard/fields';

export {
  wizardFieldInputClass,
  wizardFieldInvalidClass,
  wizardTextareaFieldClass,
} from '@/components/shared/wizard/field-styles';
export {
  FieldLabel,
  WizardErrorVisibilityProvider,
  WizardInput,
  WizardSelectTrigger,
  useWizardErrorsVisible,
  useWizardFieldClass,
} from '@/components/shared/wizard/fields';

export function FieldError({ name }: { name: string }) {
  return <WizardFieldError name={name} idPrefix="aluno-wizard" />;
}

function useWizardFieldStateClass(name: string | undefined, value: unknown, requiredIndicator: boolean) {
  return useWizardFieldClass(name, requiredIndicator, value);
}

export function IMaskControlled({
  name,
  mask,
  placeholder = '',
  ariaLabel,
  id,
  inputClassName,
  onBlur,
  unmask = false,
  requiredIndicator = false,
  'data-testid': dataTestId,
}: {
  name: string;
  mask: string | string[];
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  inputClassName?: string;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  /** Se true, salva no form apenas dígitos (sem máscara) */
  unmask?: boolean;
  requiredIndicator?: boolean;
  'data-testid'?: string;
}) {
  const ctx = useFormContext() as unknown as {
    watch: (_: string) => unknown;
    setValue: (_: string, _v: unknown, _o?: unknown) => void;
    clearErrors: (_: string) => void;
    trigger: (_: string) => Promise<boolean>;
  };
  const errorsVisible = useWizardErrorsVisible();
  const raw = ctx.watch(name);
  const val = typeof raw === 'string' ? raw : '';
  const fieldState = useWizardFieldStateClass(name, val, requiredIndicator);
  return (
    <IMaskInput
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mask={mask as any}
      unmask={unmask}
      value={val}
      onAccept={(v: unknown) => {
        ctx.setValue(name, String(v), { shouldValidate: false });
        ctx.clearErrors(name);
      }}
      onBlur={(event) => {
        onBlur?.(event);
        if (errorsVisible) void ctx.trigger(name);
      }}
      className={cn(wizardFieldInputClass, inputClassName, fieldState.className)}
      aria-invalid={fieldState.invalid || undefined}
      aria-required={requiredIndicator || undefined}
      placeholder={placeholder}
      aria-label={ariaLabel}
      id={id}
      data-testid={dataTestId || id}
    />
  );
}

// Utilitário local para formatar Date -> dd/mm/aaaa
function formatDateDDMMYYYY(d?: Date | null): string {
  if (!d || isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Campo com máscara de data que mantém o valor RHF como Date
export function DateMaskControlled({
  name,
  id,
  ariaLabel = 'Data',
  placeholder = 'dd/mm/aaaa',
  className,
  inputClassName,
  leftIcon,
  rightIcon,
  requiredIndicator = false,
}: {
  name: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string; // alias para className no input mascarado
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  requiredIndicator?: boolean;
}) {
  const ctx = useFormContext() as unknown as {
    watch: (_: string) => unknown;
    setValue: (_: string, _v: unknown, _o?: unknown) => void;
    clearErrors: (_: string) => void;
    trigger: (_: string) => Promise<boolean>;
  };
  const errorsVisible = useWizardErrorsVisible();
  const watched = ctx.watch(name) as unknown;
  const initial = useMemo(() => {
    return watched instanceof Date ? formatDateDDMMYYYY(watched) : '';
  }, [watched]);
  const [input, setInput] = useState<string>(initial);
  const fieldState = useWizardFieldStateClass(name, input, requiredIndicator);

  // Sincroniza quando o valor do formulário mudar externamente (reset, etc.)
  useEffect(() => {
    setInput(initial);
  }, [initial]);

  function handleAccept(v: unknown) {
    const s = String(v ?? '');
    setInput(s);
    ctx.clearErrors(name);
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      const iso = `${yyyy}-${mm}-${dd}T00:00:00`;
      const d = new Date(iso);
      if (!isNaN(d.getTime())) {
        ctx.setValue(name, d, { shouldValidate: false });
        return;
      }
    }
    // Se não estiver completo ou inválido, mantém undefined para não quebrar validação
    ctx.setValue(name, undefined, { shouldValidate: false });
  }

  const inputEl = (
    <IMaskInput
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mask={'00/00/0000' as any}
      value={input}
      onAccept={handleAccept}
      onBlur={() => {
        if (errorsVisible) void ctx.trigger(name);
      }}
      className={cn(
        wizardFieldInputClass,
        leftIcon && 'pl-9',
        rightIcon && 'pr-9',
        inputClassName ?? className,
        fieldState.className,
      )}
      aria-invalid={fieldState.invalid || undefined}
      aria-required={requiredIndicator || undefined}
      placeholder={placeholder}
      aria-label={ariaLabel}
      id={id}
      inputMode="numeric"
    />
  );

  if (!leftIcon && !rightIcon) return inputEl;
  return (
    <div className="relative wizard-date-field">
      {inputEl}
      {leftIcon ? (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
          {leftIcon}
        </div>
      ) : null}
      {rightIcon ? (
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          {rightIcon}
        </div>
      ) : null}
    </div>
  );
}
