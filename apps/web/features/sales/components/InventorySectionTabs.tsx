'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const sections = [
  { label: 'Estoque', href: '/sales/inventory' },
  { label: 'Reposições', href: '/sales/restocks' },
] as const;

export function InventorySectionTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Seções do estoque"
      className="mb-5 flex w-fit max-w-full items-stretch gap-1 border-b border-slate-200"
    >
      {sections.map((section) => {
        const active = pathname === section.href;

        const tab = (
          <Link
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center border-b-2 px-5 py-3 leading-6 transition-colors',
              active
                ? 'text-base font-semibold text-brand-accent'
                : 'text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800',
              active ? 'border-brand-accent' : 'border-transparent',
            )}
          >
            {section.label}
          </Link>
        );

        return active ? (
          <h1 key={section.href} className="m-0 flex font-normal">
            {tab}
          </h1>
        ) : (
          <span key={section.href} className="flex">
            {tab}
          </span>
        );
      })}
    </nav>
  );
}
