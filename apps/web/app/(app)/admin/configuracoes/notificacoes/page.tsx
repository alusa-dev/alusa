import React from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { AsaasNotificationSettings } from '@/features/settings/notifications/asaas/AsaasNotificationSettings';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export default async function ConfiguracoesNotificacoesPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  type SessUser = { role?: string; contaId?: string };
  const user = (session as { user?: SessUser } | null)?.user;
  if (!user?.contaId || !user.role || !allowedRoles.has(user.role.toUpperCase())) {
    redirect('/admin/settings');
  }

  return React.createElement(AsaasNotificationSettings);
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
