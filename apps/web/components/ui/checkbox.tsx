'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export type CheckboxProps = Omit<
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  'onCheckedChange'
> & {
  /** Alinhado ao padrão anterior do projeto: só `true` / `false` (sem indeterminate). */
  onCheckedChange?: (checked: boolean) => void;
};

const Checkbox = React.forwardRef<React.ComponentRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, onCheckedChange, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer h-4 w-4 shrink-0 rounded-[5px] border border-brand-accent bg-white shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-[#3e1f63] data-[state=checked]:bg-[#3e1f63] data-[state=checked]:text-white',
        className,
      )}
      onCheckedChange={(state) => onCheckedChange?.(state === true)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
