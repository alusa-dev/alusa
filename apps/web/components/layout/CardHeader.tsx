'use client';

import React, { useMemo, useId, useCallback, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useUserStore, type UserState, type User } from '@/lib/stores/user-store';
import { Bell, Search } from '@/components/icons/icons';
import NotificationsPanel from '@/components/notifications/NotificationsPanel';
import UserMenu from './UserMenu';
import { usePortalNotifications } from '@/hooks/use-portal-notifications';
import { useNotificationsFeed } from '@/features/notificacoes/hooks/use-notifications-feed';

export default function CardHeader(): JSX.Element {
  const router = useRouter();
  const { data } = useSession();
  // Preferir a store (atualizada pela layout) para evitar flash de avatar/nome após atualizacoes
  const storeUser = useUserStore((state: UserState) => state.user);
  const user: User | null = (storeUser ?? (data?.user as User) ?? null) as User | null;
  const name = (user?.name || 'Usuário').trim();
  const email = user?.email || 'email@exemplo.com';
  const searchId = useId();
  
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

  return (
    <div className="relative flex items-center justify-between" aria-label="Header do conteúdo">
      {/* Busca */}
      <div className="relative w-full max-w-[460px]">
        <label htmlFor={searchId} className="sr-only">
          Pesquisar
        </label>
        <div className="absolute left-3 top-1/2 -translate-y-1/2 opacity-70" aria-hidden="true">
          <Search className="h-4 w-4" />
        </div>
        <input
          id={searchId}
          type="search"
          placeholder="Pesquise aqui"
          aria-label="Pesquisar"
          className="h-11 w-full rounded-full bg-white pl-9 pr-4 text-[14px] outline-none ring-1 ring-black/5 placeholder:text-gray-400 focus:ring-2 focus:ring-[#A94DFF]"
        />
      </div>

      {/* Ações à direita */}
      <div className="flex items-center gap-4 pl-6">
        {/* Container relativo: botão + painel */}
        <div className={notificationsOpen ? 'relative z-[71]' : 'relative'} ref={notifAnchorRef}>
          <button
            type="button"
            aria-label={`Notificações${activeNotificationsCount > 0 ? ` (${activeNotificationsCount})` : ''}`}
            onClick={toggleNotifications}
            className={notificationsOpen
              ? 'relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-900 shadow-lg ring-1 ring-black/10 transition-colors hover:bg-white'
              : 'relative inline-flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-black/5 transition-colors hover:bg-black/5'}
          >
            <Bell className="h-5 w-5" />
            {/* Badge de notificações */}
            {activeNotificationsCount > 0 && (
              <span
                className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white ring-2 ring-white"
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
