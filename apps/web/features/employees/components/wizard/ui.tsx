'use client';

import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { IMaskInput } from 'react-imask';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { wizardFieldInputClass } from '@/components/shared/wizard/field-styles';
import {
  FieldLabel,
  WizardErrorVisibilityProvider,
  WizardFieldError,
  WizardInput,
  WizardSelectTrigger,
  useWizardFieldClass,
} from '@/components/shared/wizard/fields';

export { wizardFieldInputClass } from '@/components/shared/wizard/field-styles';
export {
  FieldLabel,
  WizardErrorVisibilityProvider,
  WizardInput,
  WizardSelectTrigger,
  useWizardFieldClass,
} from '@/components/shared/wizard/fields';

export function FieldError({ name }: { name: string }) {
  return (
    <WizardFieldError
      name={name}
      idPrefix="colaborador-wizard"
      tooltipClassName="colaborador-wizard-corner-smoothing"
    />
  );
}

export function IMaskControlled({
  name,
  mask,
  placeholder = '',
  ariaLabel,
  id,
  inputClassName,
  unmask = false,
  requiredIndicator = false,
}: {
  name: string;
  mask: string | string[];
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  inputClassName?: string;
  unmask?: boolean;
  requiredIndicator?: boolean;
}) {
  const { watch, setValue, clearErrors } = useFormContext();
  const raw = watch(name);
  const value = typeof raw === 'string' ? raw : '';
  const fieldState = useWizardFieldClass(name, requiredIndicator);
  return (
    <IMaskInput
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mask={mask as any}
      unmask={unmask}
      value={value}
      onAccept={(next: unknown) => {
        setValue(name, String(next), { shouldValidate: false });
        clearErrors(name);
      }}
      className={cn(wizardFieldInputClass, inputClassName, fieldState.className)}
      aria-invalid={fieldState.invalid || undefined}
      aria-required={requiredIndicator || undefined}
      placeholder={placeholder}
      aria-label={ariaLabel}
      id={id}
      data-testid={id}
    />
  );
}

function formatDate(value?: Date | null) {
  if (!value || Number.isNaN(value.getTime())) return '';
  return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
}

export function DateMaskControlled({
  name,
  id,
  ariaLabel = 'Data',
  placeholder = 'dd/mm/aaaa',
  inputClassName,
  rightIcon,
  requiredIndicator = false,
}: {
  name: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  inputClassName?: string;
  rightIcon?: React.ReactNode;
  requiredIndicator?: boolean;
}) {
  const { watch, setValue, clearErrors } = useFormContext();
  const watched = watch(name);
  const initial = watched instanceof Date ? formatDate(watched) : '';
  const [input, setInput] = React.useState(initial);
  const fieldState = useWizardFieldClass(name, requiredIndicator);
  React.useEffect(() => setInput(initial), [initial]);

  const inputElement = (
    <IMaskInput
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mask={'00/00/0000' as any}
      value={input}
      onAccept={(next: unknown) => {
        const text = String(next ?? '');
        setInput(text);
        clearErrors(name);
        const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!match) {
          setValue(name, undefined, { shouldValidate: false });
          return;
        }
        const [, day, month, year] = match;
        const date = new Date(`${year}-${month}-${day}T00:00:00`);
        setValue(name, Number.isNaN(date.getTime()) ? undefined : date, { shouldValidate: false });
      }}
      className={cn(wizardFieldInputClass, rightIcon && 'pr-9', inputClassName, fieldState.className)}
      aria-invalid={fieldState.invalid || undefined}
      aria-required={requiredIndicator || undefined}
      placeholder={placeholder}
      aria-label={ariaLabel}
      id={id}
      inputMode="numeric"
    />
  );

  return rightIcon ? (
    <div className="relative wizard-date-field">
      {inputElement}
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">{rightIcon}</div>
    </div>
  ) : inputElement;
}

export function MoneyMaskControlled({
  name,
  id,
  ariaLabel = 'Valor',
  placeholder = '0,00',
  inputClassName,
  requiredIndicator = false,
}: {
  name: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  inputClassName?: string;
  requiredIndicator?: boolean;
}) {
  const { watch, setValue, clearErrors } = useFormContext();
  const raw = watch(name);
  const format = (digits: string) => {
    if (!digits) return '';
    const padded = digits.padStart(3, '0');
    const integer = padded.slice(0, -2).replace(/^0+(?!$)/, '');
    return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${padded.slice(-2)}`;
  };
  const [display, setDisplay] = React.useState(() =>
    typeof raw === 'number' && Number.isFinite(raw) ? format(String(Math.round(raw * 100))) : '',
  );
  const typing = React.useRef(false);
  const fieldState = useWizardFieldClass(name, requiredIndicator);
  React.useEffect(() => {
    if (typing.current) return;
    setDisplay(typeof raw === 'number' && Number.isFinite(raw) ? format(String(Math.round(raw * 100))) : '');
  }, [raw]);
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      value={display}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={fieldState.invalid || undefined}
      aria-required={requiredIndicator || undefined}
      className={cn(wizardFieldInputClass, inputClassName, fieldState.className)}
      onChange={(event) => {
        typing.current = true;
        const digits = event.target.value.replace(/\D/g, '');
        const next = format(digits);
        setDisplay(next);
        setValue(name, next ? Number(next.replace(/\./g, '').replace(',', '.')) : undefined, { shouldValidate: false });
        clearErrors(name);
      }}
      onBlur={() => { typing.current = false; }}
    />
  );
}
