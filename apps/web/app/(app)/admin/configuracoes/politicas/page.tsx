import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { ContaFinancialPolicySettings } from '@/features/configuracoes/politicas/financeiro/ContaFinancialPolicySettings';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export default async function ConfiguracoesPoliticasPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  type SessUser = { role?: string; contaId?: string };
  const user = (session as { user?: SessUser } | null)?.user;

  if (!user?.contaId || !user.role || !allowedRoles.has(user.role.toUpperCase())) {
    redirect('/admin/configuracoes');
  }

  return (
    <div className="rounded-lg bg-white p-6">
      <header className="space-y-1">
        <h2 className="text-xl font-medium tracking-tight text-gray-900 md:text-2xl">Políticas</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Organize as regras operacionais da escola por domínio. Nesta primeira entrega, a seção de rematrícula concentra
          a política financeira usada para tratar pendências da matrícula anterior.
        </p>
      </header>

      <div className="mt-6">
        <ContaFinancialPolicySettings />
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
