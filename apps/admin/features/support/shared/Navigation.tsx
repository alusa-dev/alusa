'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';

type NavigationItem = { href: string; label: string; description: string };
type NavigationGroup = { label: string; items: NavigationItem[] };

const navigationGroups: NavigationGroup[] = [
  {
    label: 'Gestão',
    items: [{ href: '/contas', label: 'Contas', description: 'Escolas e organizações da plataforma' }],
  },
  {
    label: 'Integrações',
    items: [{ href: '/webhooks', label: 'Webhooks', description: 'Eventos recebidos e processamento' }],
  },
];

function NavigationMenu({ group, isOpen, onToggle, onNavigate }: { group: NavigationGroup; isOpen: boolean; onToggle: () => void; onNavigate: () => void }) {
  return (
    <div className={`admin-nav-menu${isOpen ? ' is-open' : ''}`}>
      <button type="button" className="admin-nav-trigger" aria-expanded={isOpen} onClick={onToggle}>
        <span>{group.label}</span>
        <Icon name="ChevronDown" size={14} className="admin-nav-chevron" aria-hidden="true" />
      </button>
      {isOpen ? <div className="admin-dropdown">
        {group.items.map((item) => (
          <Link key={item.href} href={item.href} className="admin-dropdown-link" onClick={onNavigate}>
            <span>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            <Icon name="ChevronRight" size={16} className="admin-dropdown-arrow" aria-hidden="true" />
          </Link>
        ))}
      </div> : null}
    </div>
  );
}

export function Navigation({ mobile = false }: { mobile?: boolean }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!navigationRef.current?.contains(event.target as Node)) setOpenGroup(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenGroup(null);
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <nav ref={navigationRef} className={mobile ? 'admin-mobile-navigation' : 'admin-navigation'} aria-label="Navegação principal">
      <Link className="admin-nav-home" href="/" onClick={() => setOpenGroup(null)}>Visão geral</Link>
      {navigationGroups.map((group) => (
        <NavigationMenu
          key={group.label}
          group={group}
          isOpen={openGroup === group.label}
          onToggle={() => setOpenGroup((current) => current === group.label ? null : group.label)}
          onNavigate={() => setOpenGroup(null)}
        />
      ))}
    </nav>
  );
}
