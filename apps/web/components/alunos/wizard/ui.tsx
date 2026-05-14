'use client';
import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { IMaskInput } from 'react-imask';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

/** Classes compartilhadas para inputs do wizard cadastro — light + modo Alusa Dark */
export const wizardFieldInputClass = cn(
  'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-none placeholder:text-gray-400',
  'focus:outline-none focus:ring-0 focus:shadow-none focus:border-gray-300 focus:bg-white focus-visible:outline-none focus-visible:ring-0',
  'alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)]',
  'alusa-dark:placeholder:text-[color:var(--color-input-placeholder)] alusa-dark:focus:border-[color:var(--color-input-border)]',
  'alusa-dark:focus:bg-[color:var(--color-input-bg)]',
);

/** Textareas (altura variável) */
export const wizardTextareaFieldClass = cn(
  'min-h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-none placeholder:text-gray-400',
  'focus:outline-none focus:ring-0 focus:shadow-none focus:border-gray-300 focus:bg-white focus-visible:outline-none focus-visible:ring-0',
  'alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)]',
  'alusa-dark:placeholder:text-[color:var(--color-input-placeholder)] alusa-dark:focus:border-[color:var(--color-input-border)]',
  'alusa-dark:focus:bg-[color:var(--color-input-bg)]',
);

export function StepHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
          {title}
        </h3>
        {hint && (
          <p className="mt-0.5 text-[11px] text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            {hint}
          </p>
        )}
      </div>
      <div />
    </div>
  );
}

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
      {children}
    </div>
  );
}

export function FieldLabel({
  children,
  required = false,
  htmlFor,
}: {
  children: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-xs font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]"
    >
      {children}{' '}
      {required && (
        <span aria-hidden="true" className="text-red-600">
          *
        </span>
      )}
    </label>
  );
}

export function FieldError({ name }: { name: string }) {
  const { formState } = useFormContext();
  const parts = name.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let curr: any = formState.errors;
  for (const p of parts) {
    curr = curr?.[p];
    if (!curr) break;
  }
  if (!curr?.message) return null;
  return <p className="mt-1 text-[11px] text-red-600">{String(curr.message)}</p>;
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
  'data-testid'?: string;
}) {
  const ctx = useFormContext() as unknown as {
    watch: (_: string) => unknown;
    setValue: (_: string, _v: unknown, _o?: unknown) => void;
  };
  const raw = ctx.watch(name);
  const val = typeof raw === 'string' ? raw : '';
  return (
    <IMaskInput
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mask={mask as any}
      unmask={unmask}
      value={val}
      onAccept={(v: unknown) => ctx.setValue(name, String(v), { shouldValidate: false })}
      onBlur={onBlur}
      className={cn(wizardFieldInputClass, inputClassName)}
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
}: {
  name: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string; // alias para className no input mascarado
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}) {
  const ctx = useFormContext() as unknown as {
    watch: (_: string) => unknown;
    setValue: (_: string, _v: unknown, _o?: unknown) => void;
  };
  const watched = ctx.watch(name) as unknown;
  const initial = useMemo(() => {
    return watched instanceof Date ? formatDateDDMMYYYY(watched) : '';
  }, [watched]);
  const [input, setInput] = useState<string>(initial);

  // Sincroniza quando o valor do formulário mudar externamente (reset, etc.)
  useEffect(() => {
    setInput(initial);
  }, [initial]);

  function handleAccept(v: unknown) {
    const s = String(v ?? '');
    setInput(s);
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
      className={cn(
        wizardFieldInputClass,
        leftIcon && 'pl-9',
        rightIcon && 'pr-9',
        inputClassName ?? className,
      )}
      placeholder={placeholder}
      aria-label={ariaLabel}
      id={id}
      inputMode="numeric"
    />
  );

  if (!leftIcon && !rightIcon) return inputEl;
  return (
    <div className="relative">
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
