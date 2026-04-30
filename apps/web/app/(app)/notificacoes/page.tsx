import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { NotificationsInboxPage } from '@/features/notificacoes/NotificationsInboxPage';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

export default async function NotificacoesPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = (session as { user?: { role?: string; contaId?: string } } | null)?.user;

  if (!user?.contaId || !user.role || !allowedRoles.has(user.role.toUpperCase())) {
    redirect('/dashboard');
  }

  return <NotificationsInboxPage />;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
