import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/ui';

// Botão primário de ação (ex: submit auth)
export const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed rounded-[30px]',
  {
    variants: {
      variant: {
        primary: 'bg-brand-primary text-white hover:brightness-110 focus-visible:outline-brand-accent',
        secondary: 'bg-white text-brand-primary outline outline-[1.5px] outline-brand-stroke hover:bg-brand-surface focus-visible:outline-brand-accent',
        ghost: 'bg-transparent text-brand-primary hover:bg-brand-surface'
      },
      size: {
        sm: 'h-9 px-4 text-[13px]',
        md: 'h-10 px-5 text-[14px]',
        lg: 'h-12 px-8 text-[14px]'
      },
      full: { true: 'w-full' }
    },
    defaultVariants: { variant: 'primary', size: 'lg' }
  }
);
export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps { full?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, full, ...rest }, ref
) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size, full }), className)} {...rest} />
  );
});
Button.displayName = 'Button';

export const inputVariants = cva(
  'w-full h-12 rounded-[30px] border border-gray-300 bg-white px-5 text-[14px] font-medium text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-300 focus:ring-0',
  {
    variants: {
      invalid: { true: 'border-red-500 focus:border-red-500' },
      withIcon: { true: 'pr-10' }
    },
    defaultVariants: { withIcon: true }
  }
);
export type InputVariantProps = VariantProps<typeof inputVariants>;
export function buildInputClass(opts?: InputVariantProps, className?: string) {
  return cn(inputVariants(opts), className);
}
