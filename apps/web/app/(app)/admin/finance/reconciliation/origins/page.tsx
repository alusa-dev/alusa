import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth-options';
import { AsaasOriginReview } from './review';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AsaasOriginReviewPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user;
  if (!user?.contaId || user.role !== 'ADMIN') redirect('/admin/settings');

  return (
    <main className="space-y-6">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Origem de recursos Asaas</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Revise assinaturas, pagamentos avulsos e parcelamentos agrupados por IDs exatos do Asaas observados nos webhooks. A prévia não grava dados. Confirme cada classificação externa manualmente e informe a evidência operacional.
        </p>
      </header>
      <AsaasOriginReview />
    </main>
  );
}
