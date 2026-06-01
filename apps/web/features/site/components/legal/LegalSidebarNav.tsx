import Link from 'next/link';
import { legalHubItems } from '@/features/site/content/legal';

type LegalSidebarNavProps = {
  activeHref?: string;
};

export function LegalSidebarNav({ activeHref }: LegalSidebarNavProps) {
  return (
    <div className="lg:pt-2.5">
      <Link href="/legal" className="text-sm font-medium text-slate-500 hover:text-[#5c2f91] transition-colors">
        Legal
      </Link>
      <nav aria-label="Páginas legais" className="mt-5">
        <ul className="space-y-1">
          {legalHubItems.map((item) => {
            const isActive = item.href === activeHref;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'flex min-h-10 items-center border-l border-[#6b3bb1] pl-3 text-sm font-semibold text-[#24123d] legal-nav-link-aligned'
                      : 'flex min-h-10 items-center border-l border-slate-200 pl-3 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:text-[#24123d] legal-nav-link-aligned'
                  }
                >
                  {item.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}