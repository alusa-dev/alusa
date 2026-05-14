'use client';

import React, { useMemo, useCallback, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useUserStore, type UserState, type User } from '@/lib/stores/user-store';
import { Bell } from '@/components/icons/icons';
import NotificationsPanel from '@/components/notifications/NotificationsPanel';
import UserMenu from './UserMenu';
import { usePortalNotifications } from '@/hooks/use-portal-notifications';
import { useNotificationsFeed } from '@/features/notificacoes/hooks/use-notifications-feed';
import { HeaderSearch } from '@/features/global-search/components/HeaderSearch';
import { useTheme } from '@/components/theme/ThemeProvider';

export default function CardHeader(): JSX.Element {
  const router = useRouter();
  const { data } = useSession();
  // Preferir a store (atualizada pela layout) para evitar flash de avatar/nome após atualizacoes
  const storeUser = useUserStore((state: UserState) => state.user);
  const user: User | null = (storeUser ?? (data?.user as User) ?? null) as User | null;
  const name = (user?.name || 'Usuário').trim();
  const email = user?.email || 'email@exemplo.com';
  
  // Buscar notificações do portal
  const { notifications, totalNotifications, loading: portalNotificationsLoading } = usePortalNotifications();
  const userRole = (user as { role?: string })?.role;
  const isPortalUser = userRole === 'ALUNO' || userRole === 'RESPONSAVEL';
  const {
    items: inboxItems,
    unreadCount,
    loading: inboxLoading,
    reload: reloadInbox,
    updateNotification,
    markAllAsRead,
  } = useNotificationsFeed({
    limit: 5,
    autoRefreshMs: 60000,
    enabled: !isPortalUser,
  });

  const initials = useMemo(() => {
    if (!name) return 'U';
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] || 'U';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
    return (first + last).toUpperCase();
  }, [name]);

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const toggleNotifications = useCallback(() => {
    setNotificationsOpen((prev) => {
      const next = !prev;
      if (next && !isPortalUser) {
        void reloadInbox();
      }
      return next;
    });
  }, [isPortalUser, reloadInbox]);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);

  const activeNotificationsCount = isPortalUser ? totalNotifications : unreadCount;
  const notificationsLoading = isPortalUser ? portalNotificationsLoading : inboxLoading;

  // Converter notificações em items para o painel
  const notificationItems = useMemo(() => {
    if (isPortalUser) {
      const items = [];

      if (notifications.cobrancasAtrasadas > 0) {
        items.push({
          id: 'cobrancas-atrasadas',
          title: 'Cobranças atrasadas',
          description: `Você tem ${notifications.cobrancasAtrasadas} cobrança(s) vencida(s)`,
          read: false,
          createdAt: new Date().toISOString(),
          severity: 'WARNING' as const,
        });
      }

      if (notifications.cobrancasPendentes > 0) {
        items.push({
          id: 'cobrancas-pendentes',
          title: 'Cobranças pendentes',
          description: `${notifications.cobrancasPendentes} cobrança(s) aguardando pagamento`,
          read: false,
          createdAt: new Date().toISOString(),
          severity: 'INFO' as const,
        });
      }

      if (notifications.proximosEventos > 0) {
        items.push({
          id: 'proximos-eventos',
          title: 'Próximos eventos',
          description: `${notifications.proximosEventos} evento(s) confirmado(s)`,
          read: false,
          createdAt: new Date().toISOString(),
          severity: 'INFO' as const,
        });
      }

      return items;
    }

    return inboxItems.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.message,
      read: Boolean(item.readAt),
      createdAt: item.triggeredAt,
      severity: item.severity,
    }));
  }, [inboxItems, isPortalUser, notifications]);

  const handleNotificationItemClick = useCallback(
    async (id: string) => {
      if (isPortalUser) {
        closeNotifications();
        router.push('/portal');
        return;
      }

      const item = inboxItems.find((entry) => entry.id === id);
      if (!item) return;

      if (!item.readAt) {
        await updateNotification(id, 'read');
      }

      closeNotifications();
      router.push('/notificacoes');
    },
    [closeNotifications, inboxItems, isPortalUser, router, updateNotification],
  );

  const handleViewAllNotifications = useCallback(() => {
    closeNotifications();
    router.push(isPortalUser ? '/portal' : '/notificacoes');
  }, [closeNotifications, isPortalUser, router]);

  const { isDark } = useTheme();

  return (
    <div className="relative flex items-center justify-between" aria-label="Header do conteúdo">
      <HeaderSearch role={userRole ?? null} />

      {/* Ações à direita */}
      <div className="flex items-center gap-4 pl-6">
        {/* Container relativo: botão + painel */}
        <div className={notificationsOpen ? 'relative z-[71]' : 'relative'} ref={notifAnchorRef}>
          <button
            type="button"
            aria-label={`Notificações${activeNotificationsCount > 0 ? ` (${activeNotificationsCount})` : ''}`}
            onClick={toggleNotifications}
            className={
              notificationsOpen
                ? isDark
                    ? 'relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--color-bg-elevated)] text-[color:var(--color-text-primary)] shadow-lg ring-1 ring-[color:var(--color-border-subtle)] transition-colors hover:bg-[color:var(--color-bg-card-soft)]'
                    : 'relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-900 shadow-lg ring-1 ring-black/10 transition-colors hover:bg-white'
                : isDark
                    ? 'relative inline-flex h-11 w-11 items-center justify-center rounded-full text-[color:var(--color-text-primary)] ring-1 ring-white/10 transition-colors hover:bg-white/5'
                    : 'relative inline-flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-black/5 transition-colors hover:bg-black/5'
            }
          >
            <Bell className="h-5 w-5" />
            {/* Badge de notificações */}
            {activeNotificationsCount > 0 && (
              <span
                className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white"
                aria-hidden="true"
              >
                {activeNotificationsCount > 99 ? '99+' : activeNotificationsCount}
              </span>
            )}
          </button>

          {/* Painel alinhado ao botão */}
          <NotificationsPanel
            open={notificationsOpen}
            onClose={closeNotifications}
            notificationCount={activeNotificationsCount}
            items={notificationItems}
            loading={notificationsLoading}
            onItemClick={(id) => void handleNotificationItemClick(id)}
            onMarkAllAsRead={!isPortalUser ? () => void markAllAsRead() : undefined}
            onViewAll={handleViewAllNotifications}
            anchorRef={notifAnchorRef}
          />
        </div>

        <UserMenu name={name} email={email} initials={initials} foto={user?.foto ?? null} />
      </div>
    </div>
  );
}
