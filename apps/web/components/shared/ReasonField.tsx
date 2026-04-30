import { type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ReasonFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id?: string;
  label?: string;
  helperText?: string;
  containerClassName?: string;
  textareaClassName?: string;
}

export function ReasonField({
  id = 'reason-field',
  label = 'Motivo (opcional)',
  helperText = 'Esse campo é opcional e serve apenas para controle interno.',
  containerClassName,
  textareaClassName,
  ...textareaProps
}: ReasonFieldProps) {
  return (
    <div className={cn('space-y-3 text-left', containerClassName)}>
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={textareaProps.rows ?? 3}
        className={cn(
          'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-[#7A1BFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/40',
          textareaProps.disabled && 'opacity-60 cursor-not-allowed',
          textareaClassName,
        )}
        {...textareaProps}
      />
      {helperText ? <p className="text-xs leading-4 text-slate-500">{helperText}</p> : null}
    </div>
  );
}

export default ReasonField;
