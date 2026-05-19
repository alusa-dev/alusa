import Link from 'next/link';
import { footerGroups } from '@/content/navigation';
import { Logo } from '@/components/ui/Logo';

export function SiteFooter() {
  return (
    <footer className="bg-alusa-purple-deeper text-white relative border-t border-white/5">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 sm:px-8 lg:grid-cols-[1.15fr_2fr] lg:py-20 lg:gap-16">
        <div>
          <div className="flex items-center gap-3 font-display text-xl font-bold tracking-tight">
            <Logo className="h-8 w-auto text-white" />
          </div>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/60">
            Infraestrutura financeira e operacional para negocios recorrentes que precisam crescer com controle absoluto do seu dinheiro e processos.
          </p>
        </div>
        <div className="grid gap-10 sm:grid-cols-3">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-white/90">{group.title}</h2>
              <ul className="mt-6 space-y-3.5">
                {group.links.map((link) => (
                  <li key={`${group.title}-${link.label}-${link.href}`}>
                    <Link href={link.href} className="text-sm font-medium text-white/60 transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10 bg-black/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between sm:px-8 font-medium">
          <span>© {new Date().getFullYear()} Alusa. Todos os direitos reservados.</span>
          <span className="opacity-80">alusa.app</span>
        </div>
      </div>
    </footer>
  );
}
