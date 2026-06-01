import Link from 'next/link';
import { legalHubItems } from '@/features/site/content/legal';

export function LegalHubPage() {
  return (
    <article className="relative overflow-hidden bg-white text-[#1d1230]">
      <div className="relative z-10 mx-auto max-w-5xl px-6 py-24 sm:px-8 lg:py-36 min-h-[50vh] flex flex-col justify-center">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-[#24123d] sm:text-5xl">
            Legal
          </h1>

          <nav aria-label="Central legal" className="mt-12">
            <ul className="space-y-5">
              {legalHubItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-xl font-medium tracking-tight text-[#5d2ca1] transition-colors hover:text-[#3e1777]"
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </article>
  );
}