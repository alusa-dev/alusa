import React from 'react';
import { cn } from '../../lib/ui';

interface BaseProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  containerClassName?: string;
}

export const InputField = React.forwardRef<HTMLInputElement, BaseProps>(function InputField(
  { label, error, icon, className, containerClassName, id, ...rest },
  ref,
) {
  const inputId = id || rest.name || Math.random().toString(36).slice(2);
  return (
    <div className={cn('w-[320px] flex flex-col gap-1', containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
      )}
      <div className="relative h-12">
        <input
          id={inputId}
          ref={ref}
          aria-invalid={!!error || undefined}
          className={cn(
            'peer w-full h-12 rounded-[30px] border border-gray-300 bg-white px-5 pr-10 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0',
            className,
          )}
          {...rest}
        />
        {icon && (
          <span
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#646464]"
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      {error && (
        <p className="text-[12px] text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
