import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import CustomerDiagnosticClient from './CustomerDiagnosticClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminTesteAsaasPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  type SessUser = { role?: string; contaId?: string };
  const role = (session as { user?: SessUser } | null)?.user?.role;
  const contaId = (session as { user?: SessUser } | null)?.user?.contaId;

  if (!role || !contaId || role.toUpperCase() !== 'ADMIN') {
    redirect('/admin/configuracoes');
  }

  return (
    <div className="rounded-lg bg-white p-6">
      <header className="space-y-1">
        <h2 className="text-xl md:text-2xl font-medium tracking-tight text-gray-900">
          Diagnóstico de Customers — Asaas
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Consulta pontual de customers por ID na subconta, sem criar cobranças e sem alterar dados.
        </p>
      </header>

      <div className="mt-6">
        <CustomerDiagnosticClient />
      </div>
    </div>
  );
}
