'use client';

import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { CircleAlert } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { SelectTrigger } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { wizardFieldInputClass, wizardFieldInvalidClass } from './field-styles';

const WizardErrorVisibilityContext = React.createContext(true);

export function WizardErrorVisibilityProvider({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <WizardErrorVisibilityContext.Provider value={visible}>
      {children}
    </WizardErrorVisibilityContext.Provider>
  );
}

export function useWizardErrorsVisible() {
  return React.useContext(WizardErrorVisibilityContext);
}

export function useWizardFieldClass(name?: string, requiredIndicator = false, valueOverride?: unknown) {
  const { formState, watch } = useFormContext();
  const errorsVisible = useWizardErrorsVisible();
  const value = valueOverride !== undefined ? valueOverride : name ? watch(name) : undefined;
  const error = name ? getFieldError(formState.errors, name) : undefined;
  const invalid = errorsVisible && Boolean(error);
  const isEmpty = value == null || value === '';

  return {
    invalid,
    className: invalid
      ? requiredIndicator && isEmpty
        ? 'wizard-field-input--required-empty'
        : wizardFieldInvalidClass
      : undefined,
  };
}

export function WizardInput({
  requiredIndicator = false,
  className,
  onChange,
  ...props
}: React.ComponentProps<typeof Input> & { requiredIndicator?: boolean }) {
  const { clearErrors } = useFormContext();
  const fieldState = useWizardFieldClass(props.name, requiredIndicator);

  return (
    <Input
      {...props}
      onChange={(event) => {
        onChange?.(event);
        if (props.name) clearErrors(props.name);
      }}
      aria-invalid={fieldState.invalid || props['aria-invalid'] || undefined}
      aria-required={requiredIndicator || props['aria-required']}
      className={cn(wizardFieldInputClass, className, fieldState.className)}
    />
  );
}

export function WizardSelectTrigger({
  name,
  requiredIndicator = false,
  className,
  ...props
}: React.ComponentProps<typeof SelectTrigger> & {
  name: string;
  requiredIndicator?: boolean;
}) {
  const fieldState = useWizardFieldClass(name, requiredIndicator);

  return (
    <SelectTrigger
      {...props}
      aria-invalid={fieldState.invalid || undefined}
      aria-required={requiredIndicator || undefined}
      className={cn(wizardFieldInputClass, 'alusa-select-trigger', className, fieldState.className)}
    />
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
      className="mb-1 block text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]"
    >
      {children}{' '}
      {required ? (
        <span aria-hidden="true" data-required-marker className="text-orange-500">
          *
        </span>
      ) : null}
    </label>
  );
}

export function WizardFieldError({
  name,
  idPrefix = 'wizard',
  tooltipClassName = 'alusa-wizard-corner-smoothing',
}: {
  name: string;
  idPrefix?: string;
  tooltipClassName?: string;
}) {
  const { formState } = useFormContext();
  const errorsVisible = useWizardErrorsVisible();
  const error = errorsVisible ? getFieldError(formState.errors, name) : undefined;
  if (error == null || error === '') return null;

  const message = String(error);
  const errorId = `${idPrefix}-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}-error`;

  return (
    <div className="relative flex h-0 justify-end pr-2" data-field-error={name}>
      <span id={errorId} role="alert" className="sr-only">
        {message}
      </span>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Erro no campo: ${message}`}
              aria-describedby={errorId}
              className="-mt-[30px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 alusa-dark:text-red-400"
            >
              <CircleAlert aria-hidden="true" className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="center"
            collisionPadding={12}
            className={cn(
              tooltipClassName,
              'max-w-[min(20rem,calc(100vw-2rem))] text-left leading-relaxed',
            )}
          >
            {message}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function getFieldError(errors: unknown, name: string): unknown {
  let value: unknown = errors;
  for (const part of name.split('.')) {
    if (typeof value !== 'object' || value === null || !(part in value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }

  return typeof value === 'object' && value !== null && 'message' in value
    ? (value as { message?: unknown }).message
    : undefined;
}
