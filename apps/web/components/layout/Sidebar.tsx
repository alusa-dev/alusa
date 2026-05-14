'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Squares2X2Icon,
  Cog6ToothIcon,
  ChevronLeftIcon,
  Squares2X2Solid,
  Cog6ToothSolid,
} from '@/components/icons/icons';
import { useTheme } from '@/components/theme/ThemeProvider';
import { usePortalNotifications } from '@/hooks/use-portal-notifications';

import { FINANCE_LOCKED_GROUP_KEYS } from './sidebar-config';
import { useSidebarNavAccess } from './use-sidebar-nav-access';

/** Tokens visuais (mantém sua coluna/tamanho) */
const TOKENS = {
  width: 262,
  widthCollapsed: 64,
  itemW: 192, // largura comum a grupo e submenu
  itemH: 52, // altura comum a grupo e submenu
} as const;

/** Collapsible com overflow hidden (evita “vazar” conteúdo fechado) */
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setH(open ? el.scrollHeight : 0);
  }, [open, children]);
  return (
    <div style={{ height: h, transition: 'height 220ms ease', overflow: 'hidden' }}>
      <div ref={ref}>{children}</div>
    </div>
  );
}

/** Marcador flutuante que desliza entre os itens selecionados (altura real: scaleY quebrava o border-radius). */
function useFloatingMarker(deps: {
  pathname: string;
  collapsed: boolean;
  openKey: string | null;
  activeKey: string | 'dashboard' | null;
}) {
  const { pathname, collapsed, openKey, activeKey } = deps;
  const navRef = useRef<HTMLElement | null>(null);
  const activeElRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [markerLayout, setMarkerLayout] = useState({ top: 0, height: 0 });

  const update = useCallback(() => {
    const nav = navRef.current;
    const el = activeElRef.current;
    if (!nav || !el) {
      setVisible((v) => (v ? false : v));
      return;
    }
    const n = nav.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const top = Math.round(e.top - n.top + nav.scrollTop);
    const height = Math.round(Math.max(el.offsetHeight, 1));
    setMarkerLayout((prev) => (prev.top === top && prev.height === height ? prev : { top, height }));
    setVisible((v) => (v ? v : true));
  }, []);

  useEffect(() => {
    const handler = () => update();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [update]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const handler = () => update();
    nav.addEventListener('scroll', handler, { passive: true });
    return () => nav.removeEventListener('scroll', handler);
  }, [update, collapsed, pathname, openKey, activeKey]);

  useLayoutEffect(() => {
    if (collapsed) return;
    update();
  }, [update, collapsed, pathname, openKey, activeKey]);

  const setActiveElement = useCallback(
    (el: HTMLElement | null) => {
      activeElRef.current = el;
      requestAnimationFrame(() => update());
    },
    [update],
  );

  return { navRef, setActiveElement, visible, markerLayout } as const;
}

function Sidebar() {
  const {
    role,
    perm,
    isPortalUser,
    sidebarLocked,
    financeLocked,
    allowedGroups,
    sourceGroups,
  } = useSidebarNavAccess();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null); // apenas 1 grupo aberto
  const [activeKey, setActiveKey] = useState<string | 'dashboard' | null>('dashboard'); // quem está selecionado
  const { isDark } = useTheme();
  const { navRef, setActiveElement, visible, markerLayout } = useFloatingMarker({
    pathname,
    collapsed,
    openKey,
    activeKey,
  });
  const { notifications } = usePortalNotifications();
  const anyGroupOpen = !collapsed && openKey !== null;
  // Gutter lateral quando recolhido (para centralizar e evitar cortar bordas)
  const collapsedGutter = Math.max(0, (TOKENS.widthCollapsed - TOKENS.itemH) / 2); // 6px

  // Largura sincronizada com o layout
  useEffect(() => {
    document.body.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
    document.documentElement.style.setProperty(
      '--sidebar-w',
      `${collapsed ? TOKENS.widthCollapsed : TOKENS.width}px`,
    );
  }, [collapsed]);

  // Rota → abre grupo correspondente e controla seleção
  useEffect(() => {
    let found: string | null = null;
    for (const g of sourceGroups) {
      if (g.items.some((i) => pathname.startsWith(i.href))) {
        found = g.key;
        break;
      }
    }
    if (found) {
      setOpenKey(found);
      setActiveKey(found); // grupo fica selecionado quando está em um submenu
    } else if (pathname.startsWith('/dashboard') || pathname.startsWith('/portal')) {
      setOpenKey(null);
      setActiveKey('dashboard');
    } else {
      setActiveKey(null);
      setOpenKey(null);
    }
  }, [pathname, sourceGroups]);

  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);
  const onClickDashboard = () => {
    setOpenKey(null);
    setActiveKey('dashboard');
  };
  const onClickGroup = (key: string) => {
    setActiveKey(key);
    setOpenKey((curr) => (curr === key ? null : key)); // accordion (um aberto por vez)
  };

  /** Estilo pílula (sem alterar cor de fonte)
   *  - expandido: largura padrão (itemW)
   *  - recolhido: largura igual à altura (quadrado), para centralizar ícone
   */
  const pill = (activeBg: boolean): React.CSSProperties => {
    // No recolhido, centraliza a pílula dentro da largura do sidebar recolhido
    const collapsedOffset = Math.max(0, (TOKENS.widthCollapsed - TOKENS.itemH) / 2);
    return {
      width: collapsed ? TOKENS.itemH : TOKENS.itemW,
      height: TOKENS.itemH,
      color: 'var(--sidebar-text)',
      backgroundColor: activeBg ? 'var(--sidebar-active-bg-light)' : 'transparent',
      marginLeft: collapsed ? collapsedOffset : 0,
      transition:
        'width 300ms cubic-bezier(0.22,1,0.36,1), margin-left 300ms cubic-bezier(0.22,1,0.36,1), background-color 200ms ease',
    } as React.CSSProperties;
  };

  return (
    <aside
      aria-label="Menu principal"
      className={[
        'hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:flex-col',
        'transition-[width] duration-300 ease-in-out',
        collapsed ? 'lg:w-16' : 'lg:w-[262px]',
      ].join(' ')}
      style={{ backgroundColor: `var(--sidebar-bg)` }}
    >
      {/* Topo (como antes): logo centralizada e botão absoluto no topo à direita */}
      <div className="relative px-4 pt-7 pb-8">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          className={[
            'flex items-center justify-center rounded-xl outline-none sidebar-text transition-colors z-10 pointer-events-auto',
            collapsed
              ? 'mx-auto block h-9 w-9'
              : 'absolute right-4 top-1/2 -translate-y-1/2 h-8 w-8 sidebar-hover',
          ].join(' ')}
          style={collapsed ? { backgroundColor: 'var(--sidebar-active-bg-light)' } : undefined}
        >
          <ChevronLeftIcon
            className={`h-5 w-5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          />
        </button>
        <div
          className={[
            'flex items-center justify-center transition-all duration-300',
            // Quando recolhido: some suavemente sem ocupar espaço
            collapsed
              ? 'opacity-0 -translate-y-1 pointer-events-none h-0 overflow-hidden'
              : 'opacity-100 translate-y-0 h-auto',
          ].join(' ')}
          aria-hidden={collapsed ? true : undefined}
        >
          <Link
            href={isPortalUser ? '/portal' : '/dashboard'}
            aria-label="Alusa"
            tabIndex={collapsed ? -1 : 0}
            prefetch={false}
          >
            <img
              src={isDark ? '/brand/logo-sidebar-dark.svg' : '/brand/logo-sidebar.svg'}
              alt="Alusa"
              width={132}
              height={40}
              fetchPriority="high"
              className="h-10 w-auto select-none transition-all duration-300"
              style={{
                opacity: collapsed ? 0 : 1,
                transform: collapsed ? 'scale(0.98)' : 'scale(1)',
              }}
              draggable={false}
            />
          </Link>
        </div>
      </div>

      {/* Navegação (sem scrollbar) */}
      <nav
        ref={navRef as React.RefObject<HTMLElement>}
        className="relative flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-0 pb-4"
        style={{
          paddingLeft: collapsed ? collapsedGutter : 'calc(8px + 12px)',
          paddingRight: collapsed ? collapsedGutter : 12,
        }}
      >
        {/* Marcador flutuante: visível apenas no estado expandido */}
        {!collapsed && (
          <span
            aria-hidden
            className="absolute left-0 w-2 rounded-r-full z-10"
            style={{
              backgroundColor: 'var(--sidebar-active-bg)',
              top: 0,
              height: markerLayout.height,
              transform: `translateY(${markerLayout.top}px)`,
              transformOrigin: 'left top',
              opacity: visible && markerLayout.height > 0 ? 1 : 0,
              left: '0px',
              transition:
                'transform 300ms cubic-bezier(0.22,1,0.36,1), height 300ms cubic-bezier(0.22,1,0.36,1), opacity 300ms cubic-bezier(0.22,1,0.36,1)',
              transitionDelay: visible ? '60ms' : '0ms',
            }}
          />
        )}
        <ul className="flex flex-col gap-2">
          {/* Dashboard / Início */}
          {perm.allowDashboard && (
            <li className="relative">
              <Link
                href={role === 'ALUNO' || role === 'RESPONSAVEL' ? '/portal' : '/dashboard'}
                prefetch={false}
                aria-label={role === 'ALUNO' || role === 'RESPONSAVEL' ? 'Início' : 'Dashboard'}
                className={[
                  'group relative mx-auto flex items-center rounded-[10px] text-[16px] outline-none select-none transition-[width,padding,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  collapsed ? 'justify-center gap-0 px-0 pl-0' : 'gap-3 px-4 pl-[30px]',
                  anyGroupOpen
                    ? 'font-light'
                    : activeKey === 'dashboard'
                      ? 'font-semibold'
                      : 'font-medium',
                  anyGroupOpen
                    ? 'opacity-40 scale-90 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
                    : '',
                  anyGroupOpen ? 'hover:scale-95' : 'hover:scale-[1.02]',
                ].join(' ')}
                style={pill(activeKey === 'dashboard')}
                onClick={onClickDashboard}
                ref={activeKey === 'dashboard' ? (el) => setActiveElement(el) : undefined}
              >
                {/* Hover overlay */}
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-[10px] z-0 opacity-0 group-hover:opacity-100 transition-[opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    backgroundColor: 'var(--sidebar-hover-bg, var(--sidebar-active-bg-light))',
                  }}
                />
                <span className="flex h-5 w-5 items-center justify-center relative z-10">
                  {activeKey === 'dashboard' ? (
                    <Squares2X2Solid className="h-5 w-5" />
                  ) : (
                    <Squares2X2Icon className="h-5 w-5" />
                  )}
                </span>
                <span
                  className={[
                    'truncate relative z-10 transition-[opacity,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                    collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-auto',
                  ].join(' ')}
                >
                  {role === 'ALUNO' || role === 'RESPONSAVEL' ? 'Início' : 'Dashboard'}
                </span>
              </Link>
            </li>
          )}

          {/* Grupos */}
          {allowedGroups.map((group) => {
            const isOpen = openKey === group.key && !collapsed;
            const groupHasRoute = group.items.some((i) => pathname.startsWith(i.href));
            const groupSelected = activeKey === group.key;
            const isFinanceGroup = FINANCE_LOCKED_GROUP_KEYS.has(group.key);
            const isComingSoonGroup = Boolean(group.comingSoon);
            const isGroupLocked = sidebarLocked || (isFinanceGroup && financeLocked);
            // Mostra marcador no grupo somente quando ele está selecionado e NÃO há submenu ativo
            // Mostra marcador no grupo quando:
            // - grupo está selecionado e não há submenu ativo; ou
            // - o submenu ativo existe, mas o grupo está FECHADO (isOpen === false)
            const showGroupMarker = (groupSelected && !groupHasRoute) || (!isOpen && groupHasRoute);

            return (
              <li key={group.key} className="relative">
                {/* Botão do grupo (sem setas) */}
                <button
                  type="button"
                  onClick={() => {
                    if (isGroupLocked || isComingSoonGroup) return;
                    onClickGroup(group.key);
                  }}
                  aria-expanded={isOpen}
                  data-testid={`sidebar-group-${group.key}`}
                  aria-disabled={isGroupLocked || isComingSoonGroup ? 'true' : undefined}
                  title={
                    sidebarLocked
                      ? 'Conclua seu cadastro para liberar o menu.'
                      : isGroupLocked
                        ? 'Finalize o cadastro financeiro para acessar o Financeiro.'
                        : isComingSoonGroup
                          ? 'Feature disponível em breve.'
                          : undefined
                  }
                  className={[
                    'group relative mx-auto flex items-center rounded-[10px] text-[16px] outline-none select-none transition-[width,padding,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                    collapsed ? 'justify-center gap-0 px-0 pl-0' : 'gap-3 px-4 pl-[30px]',
                    anyGroupOpen && openKey !== group.key
                      ? 'font-light'
                      : groupSelected || groupHasRoute
                        ? 'font-semibold'
                        : 'font-medium',
                    anyGroupOpen && openKey !== group.key
                      ? 'opacity-40 scale-90 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
                      : '',
                    isOpen
                      ? 'hover:scale-[1.02]'
                      : anyGroupOpen
                        ? 'hover:scale-95'
                        : 'hover:scale-[1.02]',
                    isGroupLocked || isComingSoonGroup
                      ? 'cursor-not-allowed opacity-50 hover:scale-100'
                      : '',
                  ].join(' ')}
                  style={pill(groupSelected)}
                  aria-label={group.label}
                  ref={showGroupMarker ? (el) => setActiveElement(el as HTMLElement) : undefined}
                >
                  {/* Hover overlay */}
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-[10px] z-0 opacity-0 group-hover:opacity-100 transition-[opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{
                      backgroundColor: 'var(--sidebar-hover-bg, var(--sidebar-active-bg-light))',
                    }}
                  />
                  <span className="flex h-5 w-5 items-center justify-center relative z-10">
                    {groupSelected || groupHasRoute ? group.iconSolid : group.icon}
                  </span>
                  <span
                    className={[
                      'truncate relative z-10 transition-[opacity,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                      collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-auto',
                    ].join(' ')}
                  >
                    {group.label}
                  </span>
                  {/* Badge 'Em breve' removido conforme solicitado */}
                </button>

                {/* Submenus — alinhados ao grupo (mesmo padding/coluna/tamanho) */}
                <Collapsible open={isOpen}>
                  <ul className="mt-1 flex flex-col gap-2">
                    {group.items.map((item) => {
                      const subActive = pathname.startsWith(item.href);
                      const isItemLocked = sidebarLocked || (isFinanceGroup && financeLocked);
                      return (
                        <li key={item.href} className="relative">
                          {isItemLocked ? (
                            <span
                              aria-label={item.label}
                              title={
                                sidebarLocked
                                  ? 'Conclua seu cadastro para liberar o menu.'
                                  : 'Finalize o cadastro financeiro para acessar o Financeiro.'
                              }
                              className={[
                                'group relative mx-auto flex items-center rounded-[10px] text-[16px] outline-none select-none transition-[width,padding,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                collapsed
                                  ? 'justify-center gap-0 px-0 pl-0'
                                  : 'gap-3 px-4 pl-[30px]',
                                'cursor-not-allowed opacity-50',
                              ].join(' ')}
                              style={pill(false)}
                            >
                              <span className="flex h-5 w-5 items-center justify-center relative z-10">
                                {item.icon}
                              </span>
                              <span
                                className={[
                                  'truncate relative z-10 transition-[opacity,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                  collapsed
                                    ? 'opacity-0 w-0 overflow-hidden'
                                    : 'opacity-100 w-auto',
                                ].join(' ')}
                              >
                                {item.label}
                              </span>
                            </span>
                          ) : (
                            <Link
                              href={item.href}
                              prefetch={false}
                              aria-label={item.label}
                              data-testid={item.href === '/planos' ? 'sidebar-planos' : undefined}
                              className={[
                                'group relative mx-auto flex items-center rounded-[10px] text-[16px] outline-none select-none transition-[width,padding,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.02]',
                                collapsed
                                  ? 'justify-center gap-0 px-0 pl-0'
                                  : 'gap-3 px-4 pl-[30px]',
                                subActive ? 'font-semibold' : 'font-medium',
                              ].join(' ')}
                              style={pill(subActive)}
                              onClick={() => setActiveKey(group.key)} // mantém o grupo como selecionado
                              aria-current={subActive ? 'page' : undefined}
                              ref={subActive && isOpen ? (el) => setActiveElement(el) : undefined}
                            >
                              {/* Hover overlay */}
                              <span
                                aria-hidden
                                className="absolute inset-0 rounded-[10px] z-0 opacity-0 group-hover:opacity-100 transition-[opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                style={{
                                  backgroundColor:
                                    'var(--sidebar-hover-bg, var(--sidebar-active-bg-light))',
                                }}
                              />
                              <span className="flex h-5 w-5 items-center justify-center relative z-10">
                                {subActive ? item.iconSolid : item.icon}
                              </span>
                              <span
                                className={[
                                  'truncate relative z-10 transition-[opacity,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                  collapsed
                                    ? 'opacity-0 w-0 overflow-hidden'
                                    : 'opacity-100 w-auto',
                                ].join(' ')}
                              >
                                {item.label}
                              </span>
                              {/* Badge de notificação para Financeiro */}
                              {isPortalUser &&
                                item.href === '/portal/financeiro' &&
                                (notifications.cobrancasPendentes > 0 ||
                                  notifications.cobrancasAtrasadas > 0) &&
                                !collapsed && (
                                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white relative z-10">
                                    {notifications.cobrancasPendentes +
                                      notifications.cobrancasAtrasadas}
                                  </span>
                                )}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Collapsible>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Configurações */}
      {perm.allowSettings && (
        <div
          className="mt-auto pb-6"
          style={{
            paddingLeft: collapsed ? collapsedGutter : 'calc(8px + 12px)',
            paddingRight: collapsed ? collapsedGutter : 12,
          }}
        >
          <ul>
            <li className="relative">
              {sidebarLocked ? (
                <span
                  aria-label="Configurações"
                  title="Conclua seu cadastro para liberar o menu."
                  className={[
                    'group relative mx-auto flex items-center rounded-[10px] text-[16px] outline-none select-none transition-[width,padding,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                    collapsed ? 'justify-center gap-0 px-0 pl-0' : 'gap-3 px-4 pl-[30px]',
                    'cursor-not-allowed opacity-50',
                  ].join(' ')}
                  style={pill(false)}
                >
                  <span className="flex h-5 w-5 items-center justify-center relative z-10">
                    <Cog6ToothIcon className="h-5 w-5" />
                  </span>
                  <span
                    className={[
                      'truncate relative z-10 transition-[opacity,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                      collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-auto',
                    ].join(' ')}
                  >
                    Configurações
                  </span>
                </span>
              ) : (
                <Link
                  href="/admin/configuracoes"
                  prefetch={false}
                  aria-label="Configurações"
                  className={[
                    'group relative mx-auto flex items-center rounded-[10px] text-[16px] outline-none select-none transition-[width,padding,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                    collapsed ? 'justify-center gap-0 px-0 pl-0' : 'gap-3 px-4 pl-[30px]',
                    anyGroupOpen
                      ? 'font-light'
                      : pathname.startsWith('/admin/configuracoes')
                        ? 'font-semibold'
                        : 'font-medium',
                    anyGroupOpen
                      ? 'opacity-40 scale-90 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
                      : '',
                    anyGroupOpen ? 'hover:scale-95' : 'hover:scale-[1.02]',
                  ].join(' ')}
                  style={pill(pathname.startsWith('/admin/configuracoes'))}
                  ref={
                    pathname.startsWith('/admin/configuracoes')
                      ? (el) => setActiveElement(el)
                      : undefined
                  }
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-[10px] z-0 opacity-0 group-hover:opacity-100 transition-[opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{
                      backgroundColor: 'var(--sidebar-hover-bg, var(--sidebar-active-bg-light))',
                    }}
                  />
                  <span className="flex h-5 w-5 items-center justify-center relative z-10">
                    {pathname.startsWith('/admin/configuracoes') ? (
                      <Cog6ToothSolid className="h-5 w-5" />
                    ) : (
                      <Cog6ToothIcon className="h-5 w-5" />
                    )}
                  </span>
                  <span
                    className={[
                      'truncate relative z-10 transition-[opacity,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                      collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-auto',
                    ].join(' ')}
                  >
                    Configurações
                  </span>
                </Link>
              )}
            </li>
          </ul>
        </div>
      )}
    </aside>
  );
}
export default Sidebar;
export { Sidebar };
