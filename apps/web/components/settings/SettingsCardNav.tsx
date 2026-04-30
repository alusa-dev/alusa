"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };

const items: Item[] = [
  { href: "/admin/configuracoes/usuarios", label: "Usuários e Convites" },
  { href: "/admin/configuracoes/integracoes", label: "Integrações" },
  { href: "/admin/configuracoes/politicas", label: "Políticas" },
  { href: "/admin/configuracoes/notificacoes", label: "Notificações" },
];

export default function SettingsCardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação de Configurações" data-testid="settings-card-nav">
      <ul className="space-y-2">
        {items.map((it) => {
          const active = pathname?.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                  active
                    ? "bg-purple-50 text-purple-700 font-medium"
                    : "bg-white text-gray-700 hover:bg-gray-50",
                  "focus:outline-none focus:ring-0",
                ].join(" ")}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
