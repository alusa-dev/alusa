import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { ExternalAsaasOnboarding } from '@/components/external-asaas-onboarding/ExternalAsaasOnboarding';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AsaasIntegrationManagementPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  type SessUser = {
    role?: string;
    contaId?: string | null;
    financeIntegrationMode?: string;
  };
  const user = (session as { user?: SessUser } | null)?.user;
  const role = user?.role?.toUpperCase() ?? '';

  if (!user?.contaId || !['ADMIN', 'FINANCEIRO'].includes(role)) {
    redirect('/admin/configuracoes');
  }

  if (user.financeIntegrationMode !== 'EXTERNAL_ASAAS_ACCOUNT') {
    redirect('/admin/configuracoes/integracoes');
  }

  return (
    <div className="rounded-lg bg-white p-6">
      <header className="space-y-1">
        <h2 className="text-xl md:text-2xl font-medium tracking-tight text-gray-900">
          Integração Asaas
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Gerencie a API key da conta existente do Asaas, acompanhe o vínculo da conta conectada e
          substitua a credencial quando necessário.
        </p>
      </header>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <ExternalAsaasOnboarding variant="settings" />
      </div>
    </div>
  );
}