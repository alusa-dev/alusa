import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Ajuda',
};

const SUPPORT_EMAIL = 'gestao.alusa@gmail.com';

export default function AjudaPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
          Ajuda
        </h1>
        <p className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
          Encontre orientações rápidas ou fale com o time da Alusa.
        </p>
      </header>

      <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
        <div className="space-y-1">
          <h2 className="text-base font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
            Suporte
          </h2>
          <p className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            Para dúvidas sobre cadastro, financeiro ou acesso à plataforma, envie um e-mail descrevendo o
            problema e, se possível, a escola e a tela em que ocorreu.
          </p>
        </div>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="inline-flex text-sm font-medium text-brand-accent hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
        <h2 className="text-base font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
          Atalhos
        </h2>
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/conta/perfil" className="text-brand-accent hover:underline">
              Minha conta → Perfil
            </Link>
          </li>
          <li>
            <Link href="/conta/seguranca" className="text-brand-accent hover:underline">
              Minha conta → Segurança
            </Link>
          </li>
          <li>
            <Link href="/dashboard" className="text-brand-accent hover:underline">
              Voltar ao painel
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
