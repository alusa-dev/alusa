import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

export const buttonVariants = cva('alusa-button', {
  variants: {
    variant: {
      default: 'alusa-button--default',
      primary: 'alusa-button--default',
      destructive: 'alusa-button--destructive',
      outline: 'alusa-button--outline',
      secondary: 'alusa-button--secondary',
      ghost: 'alusa-button--ghost',
      link: 'alusa-button--link',
      wizardPrimary: 'alusa-button--wizard-primary',
      wizardSecondary: 'alusa-button--wizard-secondary',
    },
    size: {
      default: 'alusa-button--default-size',
      sm: 'alusa-button--small',
      lg: 'alusa-button--large',
      icon: 'alusa-button--icon',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : 'button';

    return (
      <Component
        className={[buttonVariants({ variant, size }), className].filter(Boolean).join(' ')}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';

export { Button };
