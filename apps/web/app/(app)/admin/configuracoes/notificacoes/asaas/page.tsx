import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { AsaasNotificationSettings } from '@/features/configuracoes/notificacoes/asaas/AsaasNotificationSettings';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export default async function ConfiguracoesNotificacoesAsaasPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  type SessUser = { role?: string; contaId?: string };
  const user = (session as { user?: SessUser } | null)?.user;
  if (!user?.contaId || !user.role || !allowedRoles.has(user.role.toUpperCase())) {
    redirect('/admin/configuracoes');
  }

  return (
    <div className="rounded-lg bg-white p-6">
      <header className="space-y-1">
        <h2 className="text-xl md:text-2xl font-medium tracking-tight text-gray-900">Notificações</h2>
        <p className="mt-1 text-sm text-gray-600">
          Configure os canais de comunicação automática para lembretes de cobrança. As opções abaixo
          passam a valer para novas cobranças geradas a partir desta régua global.
        </p>
      </header>
      <div className="mt-4">
        <AsaasNotificationSettings />
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
