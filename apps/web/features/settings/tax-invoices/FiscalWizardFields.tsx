'use client';

import type { ComponentProps, HTMLAttributes } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldHelpTooltip } from '@/components/ui/field-help-tooltip';
import { cn } from '@/lib/utils';

export const FISCAL_WIZARD_PANEL_CLASS =
  'alusa-session-panel space-y-5 rounded-xl border border-[#e5e7eb] bg-white p-5 md:p-6';

export const FISCAL_WIZARD_FIELD_CLASS = 'space-y-1.5';

export function FiscalFieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600">{message}</p>;
}

export function FiscalFieldLabel({ label, help }: { label: string; help?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-sm font-medium text-gray-900">{label}</Label>
      {help ? <FieldHelpTooltip content={help} /> : null}
    </div>
  );
}

export function fiscalInputClass(hasError: boolean) {
  return cn(
    'h-10 border-gray-300 bg-white text-gray-900',
    hasError && 'border-red-500 focus-visible:ring-red-500/30',
  );
}

type FiscalSelectProps = {
  label: string;
  help?: string;
  value?: string;
  placeholder?: string;
  options: Array<{ label: string; value: string }>;
  error?: string;
  onChange: (value: string) => void;
};

export function FiscalSelect({
  label,
  help,
  value,
  placeholder = 'Selecione…',
  options,
  error,
  onChange,
}: FiscalSelectProps) {
  return (
    <div className={FISCAL_WIZARD_FIELD_CLASS}>
      <FiscalFieldLabel label={label} help={help} />
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className={fiscalInputClass(Boolean(error))}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-sm">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FiscalFieldError message={error} />
    </div>
  );
}

type FiscalTextFieldProps = {
  label: string;
  help?: string;
  value: string;
  error?: string;
  placeholder?: string;
  type?: ComponentProps<typeof Input>['type'];
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  onChange: (value: string) => void;
};

export function FiscalTextField({
  label,
  help,
  value,
  error,
  placeholder,
  type = 'text',
  inputMode,
  onChange,
}: FiscalTextFieldProps) {
  return (
    <div className={FISCAL_WIZARD_FIELD_CLASS}>
      <FiscalFieldLabel label={label} help={help} />
      <Input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        className={fiscalInputClass(Boolean(error))}
        onChange={(event) => onChange(event.target.value)}
      />
      <FiscalFieldError message={error} />
    </div>
  );
}
