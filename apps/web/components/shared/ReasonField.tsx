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
  helperText,
  containerClassName,
  textareaClassName,
  ...textareaProps
}: ReasonFieldProps) {
  return (
    <div className={cn('space-y-3 text-left', containerClassName)}>
      <label
        htmlFor={id}
      className="block text-xs font-medium text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]"
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={textareaProps.rows ?? 2}
        className={cn(
          'w-full rounded-[10px] border-0 bg-[#eff3f8] px-3 py-2 text-[13px] leading-5 text-slate-900 shadow-none transition-colors duration-150 placeholder:text-slate-400 hover:bg-[#eff3f8] focus:border-0 focus:outline-none focus:ring-0 focus-visible:shadow-[inset_0_0_0_1px_#9ca3af] alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-text-primary)]',
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
