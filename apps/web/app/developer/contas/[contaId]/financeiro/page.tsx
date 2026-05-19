import { notFound } from 'next/navigation';
import Link from 'next/link';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import {
  getSupportAccount,
  getSupportFinanceOverview,
  listSupportAccountFinance,
} from '@/features/support/queries/support-account';
import { compactId, formatCurrency, formatDate } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { StatusBadge, SupportMetric, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportAccountFinancePage({
  params,
}: {
  params: Promise<{ contaId: string }>;
}) {
  const resolvedParams = await params;
  const session = await requireGlobalAdminSessionForPage(
    `/developer/contas/${resolvedParams.contaId}/financeiro`,
  );
  const [account, charges, overview] = await Promise.all([
    getSupportAccount(resolvedParams.contaId),
    listSupportAccountFinance(resolvedParams.contaId),
    getSupportFinanceOverview(resolvedParams.contaId),
  ]);
  if (!account) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Financeiro"
        title={`Financeiro de ${account.conta.nome}`}
        description="Cobranças, recorrências, parcelamentos, transferências, conciliação e divergências por contaId."
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SupportMetric label="Cobranças" value={charges.length} />
        <SupportMetric label="Assinaturas" value={overview.subscriptions.length + overview.standaloneSubscriptions.length} />
        <SupportMetric label="Parcelamentos" value={overview.installmentPlans.length + overview.standaloneInstallments.length} />
        <SupportMetric label="Transferências" value={overview.transfers.length} />
        <SupportMetric label="Divergências" value={overview.divergentCharges.length} tone="warning" />
        <SupportMetric label="Jobs" value={overview.integrationJobs.length} />
      </div>

      <SupportPanel title="Cobranças" description={`${charges.length} registros recentes`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-3 pr-4">Pagador</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Valor</th>
                <th className="py-3 pr-4">Vencimento</th>
                <th className="py-3 pr-4">Origem</th>
                <th className="py-3 pr-4">Asaas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {charges.map((charge) => (
                <tr key={charge.id}>
                  <td className="py-3 pr-4">
                    <Link
                      className="font-medium text-slate-950 hover:underline"
                      href={`/developer/contas/${resolvedParams.contaId}/financeiro/cobrancas/${charge.id}`}
                    >
                      {charge.payerName}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={charge.status} />
                  </td>
                  <td className="py-3 pr-4">{formatCurrency(charge.value)}</td>
                  <td className="py-3 pr-4">{formatDate(charge.dueDate)}</td>
                  <td className="py-3 pr-4">
                    {charge.origin} · {charge.chargeType}
                  </td>
                  <td className="py-3 pr-4">{compactId(charge.asaasPaymentId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SupportPanel>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SupportPanel title="Assinaturas" description="Recorrências vinculadas à escola.">
          <div className="space-y-3">
            {[...overview.subscriptions, ...overview.standaloneSubscriptions].map((item) => (
              <div key={item.id} className="rounded-md border border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-950">{compactId(item.asaasSubscriptionId ?? item.id)}</p>
                  <StatusBadge value={item.status} />
                </div>
              </div>
            ))}
          </div>
        </SupportPanel>

        <SupportPanel title="Parcelamentos, repasses e divergências" description="Diagnóstico financeiro avançado da conta.">
          <div className="space-y-3">
            {[...overview.installmentPlans, ...overview.standaloneInstallments].slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-md border border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-950">{compactId(item.asaasInstallmentId ?? item.id)}</p>
                  <StatusBadge value={item.status} />
                </div>
              </div>
            ))}
            {overview.transfers.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-md border border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-950">{formatCurrency(item.value)}</p>
                  <StatusBadge value={item.rawAsaasStatus ?? item.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{compactId(item.asaasTransferId ?? item.id)}</p>
              </div>
            ))}
            {overview.divergentCharges.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-md border border-amber-200 px-4 py-3">
                <p className="text-sm font-medium text-slate-950">{compactId(item.asaasPaymentId ?? item.id)}</p>
                <p className="mt-1 text-xs text-slate-600">Local {item.status} · Asaas {item.asaasStatus}</p>
              </div>
            ))}
          </div>
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
