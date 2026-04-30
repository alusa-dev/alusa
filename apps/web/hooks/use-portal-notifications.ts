import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface NotificationData {
  cobrancasPendentes: number;
  cobrancasAtrasadas: number;
  proximosEventos: number;
}

export function usePortalNotifications() {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<NotificationData>({
    cobrancasPendentes: 0,
    cobrancasAtrasadas: 0,
    proximosEventos: 0,
  });
  const [loading, setLoading] = useState(true);

  const user = session?.user as { role?: string } | undefined;
  const isPortalUser = user?.role === 'ALUNO' || user?.role === 'RESPONSAVEL';

  useEffect(() => {
    async function loadNotifications() {
      // Apenas carregar para usuários do portal
      if (!isPortalUser) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/portal/notifications');
        if (response.ok) {
          const data = await response.json();
          setNotifications(data);
        }
      } catch (error) {
        console.error('Erro ao carregar notificações:', error);
      } finally {
        setLoading(false);
      }
    }

    if (session?.user) {
      loadNotifications();
      
      // Atualizar a cada 5 minutos
      const interval = setInterval(loadNotifications, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [session, isPortalUser]);

  return {
    notifications,
    loading,
    totalNotifications:
      notifications.cobrancasPendentes +
      notifications.cobrancasAtrasadas +
      notifications.proximosEventos,
  };
}




