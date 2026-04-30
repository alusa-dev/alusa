import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { IntegracoesFeature } from '@/features/integracoes/IntegracoesFeature';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ConfigIntegracoesPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  type SessUser = { role?: string; contaId?: string };
  const role = (session as { user?: SessUser } | null)?.user?.role;
  const contaId = (session as { user?: SessUser } | null)?.user?.contaId;
  if (!role || !contaId || !['ADMIN', 'FINANCEIRO'].includes(role.toUpperCase())) {
    redirect('/admin/configuracoes');
  }
  return (
    <div className="rounded-lg bg-white p-6">
      <header className="space-y-1">
        <h2 className="text-xl md:text-2xl font-medium tracking-tight text-gray-900">Integrações</h2>
        <p className="mt-1 text-sm text-gray-600">
          Conecte os serviços que sustentam cobranças, notificações e demais automações da Alusa. Os
          cards abaixo exibem o status atualizado de cada integração e as ações necessárias para
          mantê-las saudáveis.
        </p>
      </header>
      <div className="mt-4">
        <IntegracoesFeature />
      </div>
    </div>
  );
}
