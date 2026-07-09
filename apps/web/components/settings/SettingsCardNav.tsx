'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string };

const items: Item[] = [
  { href: '/admin/configuracoes/usuarios', label: 'Usuários e Convites' },
  { href: '/admin/configuracoes/integracoes', label: 'Integrações' },
  { href: '/admin/configuracoes/notificacoes', label: 'Notificações' },
  { href: '/admin/configuracoes/notafiscal', label: 'Nota Fiscal' },
];

export default function SettingsCardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação de Configurações" data-testid="settings-card-nav" className="w-full md:w-[191px]">
      <ul className="space-y-2.5">
        {items.map((item) => {
          const active = pathname?.startsWith(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex h-[35px] w-full items-center rounded-[7px] px-[21px] text-sm transition-colors duration-150',
                  active
                    ? 'bg-[#f9f0ff] font-medium text-[#361D56] alusa-dark:bg-[color:rgba(169,77,255,0.18)] alusa-dark:text-[color:var(--color-text-primary)]'
                    : 'bg-transparent text-[#1d1830] hover:bg-[#fbf7ff] alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.06)]',
                  'focus:outline-none focus:ring-0',
                ].join(' ')}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
