'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

export function resolveExpertContactHref(pathname: string | null, rawCount: string | null): string {
  if (pathname !== '/precos' || !rawCount || !/^\d+$/.test(rawCount)) return '/get-started';
  const count = Number(rawCount);
  return Number.isSafeInteger(count) && count >= 1
    ? `/get-started?studentCount=${count}`
    : '/get-started';
}

export function ExpertContactLink({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <Link href={resolveExpertContactHref(pathname, searchParams.get('studentCount'))} className={className}>
      {children}
    </Link>
  );
}
