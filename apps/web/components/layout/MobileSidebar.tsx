'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Cog6ToothIcon,
  Cog6ToothSolid,
  Squares2X2Icon,
  Squares2X2Solid,
  X,
} from '@/components/icons/icons';
import { useTheme } from '@/components/theme/ThemeProvider';
import { usePortalNotifications } from '@/hooks/use-portal-notifications';
import { SidebarLogoMark } from '@/components/layout/SidebarLogoMark';
import { FINANCE_LOCKED_GROUP_KEYS } from '@/components/layout/sidebar-config';
import { useSidebarNavAccess } from '@/components/layout/use-sidebar-nav-access';

const SETTINGS_HREF = '/admin/configuracoes';

type MobileSidebarProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
};

export function MobileSidebar({ open, onOpenChange }: MobileSidebarProps) {
  const pathname = usePathname();
  const { isDark } = useTheme();
  const { notifications } = usePortalNotifications();
  const { perm, isPortalUser, sidebarLocked, financeLocked, allowedGroups } = useSidebarNavAccess();

  const dashboardHref = isPortalUser ? '/portal' : '/dashboard';
  const dashboardLabel = isPortalUser ? 'Início' : 'Dashboard';
  const dashboardActive =
    pathname === dashboardHref ||
    pathname.startsWith(`${dashboardHref}/`) ||
    (dashboardHref === '/portal' && pathname.startsWith('/portal'));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-label="Fechar menu"
      />

      <aside className="relative flex h-full max-w-[min(86vw,340px)] flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
          <Link
            href={dashboardHref}
            prefetch={false}
            onClick={() => onOpenChange(false)}
            className="inline-flex"
          >
            <SidebarLogoMark isDark={isDark} size="compact" className="select-none" />
          </Link>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-900"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 space-y-6 px-3 py-4" aria-label="Menu principal">
          {perm.allowDashboard && (
            <div>
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Geral
              </p>
              <Link
                href={dashboardHref}
                prefetch={false}
                onClick={() => onOpenChange(false)}
                className={[
                  'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                  dashboardActive
                    ? 'bg-[var(--sidebar-active-bg-light)] text-[var(--brand-primary)]'
                    : 'text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {dashboardActive ? (
                  <Squares2X2Solid className="h-5 w-5 shrink-0" />
                ) : (
                  <Squares2X2Icon className="h-5 w-5 shrink-0" />
                )}
                {dashboardLabel}
              </Link>
            </div>
          )}

          {allowedGroups.map((group) => {
            const isFinanceGroup = FINANCE_LOCKED_GROUP_KEYS.has(group.key);
            const isComingSoon = Boolean(group.comingSoon);

            return (
              <div key={group.key}>
                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {group.label}
                  {isComingSoon ? ' · em breve' : ''}
                </p>
                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const itemLocked =
                      sidebarLocked || (isFinanceGroup && financeLocked) || isComingSoon;
                    const badgeCount =
                      isPortalUser &&
                      item.href === '/portal/financeiro' &&
                      (notifications.cobrancasPendentes > 0 || notifications.cobrancasAtrasadas > 0)
                        ? notifications.cobrancasPendentes + notifications.cobrancasAtrasadas
                        : 0;

                    if (itemLocked) {
                      return (
                        <li key={item.href}>
                          <span
                            className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-gray-400 opacity-60"
                            title={
                              sidebarLocked
                                ? 'Conclua seu cadastro para liberar o menu.'
                                : 'Indisponível no momento.'
                            }
                          >
                            <span className="shrink-0">{item.icon}</span>
                            <span className="min-w-0 flex-1">{item.label}</span>
                            {badgeCount > 0 ? (
                              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
                                {badgeCount}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    }

                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          prefetch={false}
                          onClick={() => onOpenChange(false)}
                          className={[
                            'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                            active
                              ? 'bg-[var(--sidebar-active-bg-light)] text-[var(--brand-primary)]'
                              : 'text-gray-700 hover:bg-gray-50',
                          ].join(' ')}
                          aria-current={active ? 'page' : undefined}
                        >
                          <span className="shrink-0">{active ? item.iconSolid : item.icon}</span>
                          <span className="min-w-0 flex-1">{item.label}</span>
                          {badgeCount > 0 ? (
                            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
                              {badgeCount}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {perm.allowSettings && (
            <div>
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Sistema
              </p>
              {sidebarLocked ? (
                <span
                  className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-gray-400 opacity-60"
                  title="Conclua seu cadastro para liberar o menu."
                >
                  <Cog6ToothIcon className="h-5 w-5 shrink-0" />
                  Configurações
                </span>
              ) : (
                <Link
                  href={SETTINGS_HREF}
                  prefetch={false}
                  onClick={() => onOpenChange(false)}
                  className={[
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                    pathname.startsWith(SETTINGS_HREF)
                      ? 'bg-[var(--sidebar-active-bg-light)] text-[var(--brand-primary)]'
                      : 'text-gray-700 hover:bg-gray-50',
                  ].join(' ')}
                >
                  {pathname.startsWith(SETTINGS_HREF) ? (
                    <Cog6ToothSolid className="h-5 w-5 shrink-0" />
                  ) : (
                    <Cog6ToothIcon className="h-5 w-5 shrink-0" />
                  )}
                  Configurações
                </Link>
              )}
            </div>
          )}
        </nav>
      </aside>
    </div>
  );
}
