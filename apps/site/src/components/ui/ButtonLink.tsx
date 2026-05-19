'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from '@/components/icons/icons';
import { trackSiteEvent, type SiteEvent } from '@/lib/analytics';
import { cn } from '@/lib/cn';

type ButtonLinkProps = {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly tone?: 'light' | 'dark';
  readonly event?: SiteEvent;
  readonly className?: string;
  readonly showArrow?: boolean;
};

const variants = {
  light: {
    primary:
      'bg-alusa-purple text-white hover:bg-alusa-purple-hover focus-visible:ring-white',
    secondary:
      'border border-alusa-purple-dark/12 bg-white text-alusa-purple-dark hover:border-alusa-purple/35 hover:bg-alusa-purple-tint',
    ghost: 'text-alusa-purple-dark hover:bg-alusa-purple-dark/[0.06]'
  },
  dark: {
    primary: 'bg-white text-alusa-purple-dark hover:bg-white/92 focus-visible:ring-alusa-purple-deeper',
    secondary:
      'border border-white/35 bg-transparent text-white hover:border-white hover:bg-white/10',
    ghost: 'text-white/88 hover:bg-white/10'
  }
} as const;

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  tone = 'light',
  event,
  className,
  showArrow = true
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      onClick={() => {
        if (event) {
          trackSiteEvent(event, { href });
        }
      }}
      className={cn(
        'inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-6 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        tone === 'dark' ? 'focus-visible:ring-offset-alusa-purple' : 'focus-visible:ring-offset-white',
        variants[tone][variant],
        className
      )}
    >
      <span className="truncate">{children}</span>
      {showArrow && variant !== 'ghost' ? (
        <ArrowRight className="h-4 w-4 flex-none" aria-hidden="true" />
      ) : null}
    </Link>
  );
}
