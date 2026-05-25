'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from '@/features/site/components/icons/icons';
import { trackSiteEvent, type SiteEvent } from '@/features/site/lib/analytics';
import { cn } from '@/features/site/lib/cn';

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
      'border border-transparent bg-alusa-purple text-white hover:bg-alusa-purple-hover focus-visible:ring-white',
    secondary:
      'border border-alusa-purple-dark/12 bg-white text-alusa-purple-dark hover:border-alusa-purple hover:bg-alusa-purple hover:text-white',
    ghost: 'text-alusa-purple-dark hover:bg-alusa-purple hover:text-white'
  },
  dark: {
    primary:
      'border border-transparent bg-white text-alusa-purple-dark hover:border-alusa-purple hover:bg-alusa-purple hover:text-white focus-visible:ring-alusa-purple-deeper',
    secondary:
      'border border-white/35 bg-transparent text-white hover:border-alusa-purple hover:bg-alusa-purple hover:text-white',
    ghost: 'text-white/88 hover:bg-alusa-purple hover:text-white'
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
        'inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-6 text-sm font-semibold transition-colors duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
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
