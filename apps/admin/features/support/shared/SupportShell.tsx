import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { AdminSession } from '@/lib/admin-session';
import { Navigation } from './Navigation';

function Brand() {
  return (
    <Link className="admin-brand" href="/" aria-label="Alusa Admin — Visão geral">
      <Image className="admin-brand-logo" src="/brand/logo-light.svg" alt="Alusa" width={122} height={37} priority />
    </Link>
  );
}

function AdminAccountMenu({ session }: { session: AdminSession }) {
  return (
    <details className="admin-identity">
      <summary>
        <span className="admin-avatar" aria-hidden="true">{session.username.slice(0, 1).toUpperCase()}</span>
        <span className="admin-identity-copy"><strong>{session.username}</strong><small>{session.adminRole}</small></span>
        <Icon name="ChevronDown" size={14} className="admin-nav-chevron" aria-hidden="true" />
      </summary>
      <div className="admin-identity-menu">
        <span className="admin-identity-label">Sessão administrativa</span>
        <strong>{session.username}</strong>
        <small>{session.adminRole}</small>
        <div className="admin-account-actions">
          <Link href="/configuracoes" className="admin-account-link">Configurações<Icon name="ChevronRight" size={16} aria-hidden="true" /></Link>
          <form action="/api/auth/logout" method="post">
            <button className="admin-account-logout" type="submit">Sair</button>
          </form>
        </div>
      </div>
    </details>
  );
}

export function SupportShell({ children, session }: { children: ReactNode; session: AdminSession }) {
  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <Brand />
          <Navigation />
          <div className="admin-header-actions">
            <AdminAccountMenu session={session} />
            <details className="admin-mobile-menu">
              <summary aria-label="Abrir menu"><Icon name="Bars3" size={18} aria-hidden="true" /></summary>
              <Navigation mobile />
            </details>
          </div>
        </div>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
