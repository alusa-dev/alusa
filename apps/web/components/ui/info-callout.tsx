import * as React from 'react';
import Link from 'next/link';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Avisos informativos: fundo sólido, sem borda, cantos arredondados (padrão Alusa). */
const infoCalloutVariants = cva('w-full rounded-xl border-0 px-3.5 py-3 sm:px-4', {
  variants: {
    variant: {
      info: 'bg-[#d9f2f5] text-slate-700',
      brand: 'bg-[#ebe3f4] text-slate-700',
      warning: 'bg-[#fef6e7] text-amber-900',
    },
    size: {
      sm: 'text-xs leading-relaxed',
      md: 'text-sm leading-relaxed',
    },
  },
  defaultVariants: {
    variant: 'info',
    size: 'md',
  },
});

const iconVariants: Record<NonNullable<VariantProps<typeof infoCalloutVariants>['variant']>, string> = {
  info: 'text-[#1f6b75]',
  brand: 'text-[#5c2f91]',
  warning: 'text-amber-700',
};

const titleVariants: Record<NonNullable<VariantProps<typeof infoCalloutVariants>['variant']>, string> = {
  info: 'text-slate-800',
  brand: 'text-slate-800',
  warning: 'text-amber-950',
};

const linkVariants: Record<NonNullable<VariantProps<typeof infoCalloutVariants>['variant']>, string> = {
  info: 'font-medium text-[#1f6b75] underline underline-offset-2 hover:text-[#174f57]',
  brand: 'font-medium text-[#5c2f91] underline underline-offset-2 hover:text-[#4b217a]',
  warning: 'font-medium text-amber-800 underline underline-offset-2 hover:text-amber-950',
};

export type InfoCalloutVariant = NonNullable<VariantProps<typeof infoCalloutVariants>['variant']>;
export type InfoCalloutLabelTone = 'default' | 'warning' | 'caution' | 'danger' | 'muted';

const labelToneClasses: Record<InfoCalloutLabelTone, string> = {
  default: 'text-slate-800',
  warning: 'text-amber-700',
  caution: 'text-orange-700',
  danger: 'text-red-700',
  muted: 'text-slate-600',
};

export interface InfoCalloutProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof infoCalloutVariants> {
  title?: React.ReactNode;
  showIcon?: boolean;
}

function hasStructuredItems(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === InfoCalloutItem,
  );
}

export function InfoCallout({
  variant = 'info',
  size = 'md',
  title,
  showIcon = false,
  className,
  children,
  ...props
}: InfoCalloutProps) {
  const resolvedVariant = variant ?? 'info';
  const structured = Boolean(title) || hasStructuredItems(children);

  if (structured) {
    return (
      <div
        role="note"
        className={cn(infoCalloutVariants({ variant: resolvedVariant, size }), className)}
        {...props}
      >
        <div className="flex gap-2.5 sm:gap-3">
          {showIcon ? (
            <InformationCircleIcon
              className={cn('h-5 w-5 shrink-0', iconVariants[resolvedVariant])}
              aria-hidden
            />
          ) : null}
          <div className="min-w-0 flex-1">
            {title ? (
              <p
                className={cn(
                  'mb-2 font-semibold',
                  size === 'sm' ? 'text-xs' : 'text-sm',
                  titleVariants[resolvedVariant],
                )}
              >
                {title}
              </p>
            ) : null}
            <div
              className={cn(
                hasStructuredItems(children) ? 'space-y-1.5' : undefined,
                size === 'sm' ? 'text-xs' : 'text-sm',
              )}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="note"
      className={cn(infoCalloutVariants({ variant: resolvedVariant, size }), className)}
      {...props}
    >
      <div
        className={cn(
          'flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3',
          size === 'sm' ? 'text-xs' : 'text-sm',
        )}
      >
        {showIcon ? (
          <InformationCircleIcon
            className={cn('h-5 w-5 shrink-0', iconVariants[resolvedVariant])}
            aria-hidden
          />
        ) : null}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export interface InfoCalloutItemProps extends React.HTMLAttributes<HTMLParagraphElement> {
  label: React.ReactNode;
  labelTone?: InfoCalloutLabelTone;
}

export function InfoCalloutItem({
  label,
  labelTone = 'default',
  className,
  children,
  ...props
}: InfoCalloutItemProps) {
  return (
    <p className={cn(className)} {...props}>
      <span className={cn('font-semibold', labelToneClasses[labelTone])}>{label}:</span> {children}
    </p>
  );
}

export interface InfoCalloutLinkProps extends React.ComponentProps<typeof Link> {
  calloutVariant?: InfoCalloutVariant;
}

export function InfoCalloutLink({
  calloutVariant = 'info',
  className,
  ...props
}: InfoCalloutLinkProps) {
  const resolvedVariant = calloutVariant ?? 'info';
  return <Link className={cn(linkVariants[resolvedVariant], className)} {...props} />;
}
