import Link from 'next/link';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import {
  getSupportFinanceOverview,
  listSupportAccountFinance,
} from '@/features/support/queries/support-account';
import { compactId, formatCurrency, formatDate, formatDateTime } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { StatusBadge, SupportMetric, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportFinancePage() {
  const session = await requireGlobalAdminSessionForPage('/developer/financeiro');
  const [charges, overview] = await Promise.all([
    listSupportAccountFinance(),
    getSupportFinanceOverview(),
  ]);

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Financeiro"
        title="Operação financeira"
        description="Leitura cross-tenant para cobranças, assinaturas, parcelamentos, transferências, conciliação e divergências."
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SupportMetric label="Cobranças" value={charges.length} />
        <SupportMetric label="Assinaturas" value={overview.subscriptions.length + overview.standaloneSubscriptions.length} />
        <SupportMetric label="Parcelamentos" value={overview.installmentPlans.length + overview.standaloneInstallments.length} />
        <SupportMetric label="Transferências" value={overview.transfers.length} />
        <SupportMetric label="Divergências" value={overview.divergentCharges.length} tone="warning" />
        <SupportMetric label="Jobs integração" value={overview.integrationJobs.length} />
      </div>

      <SupportPanel title="Cobranças" description={`${charges.length} registros recentes`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-3 pr-4">Conta</th>
                <th className="py-3 pr-4">Pagador</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Valor</th>
                <th className="py-3 pr-4">Vencimento</th>
                <th className="py-3 pr-4">Asaas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {charges.map((charge) => (
                <tr key={charge.id}>
                  <td className="py-3 pr-4">
                    <Link
                      className="font-medium text-slate-950 hover:underline"
                      href={`/developer/contas/${charge.contaId}`}
                    >
                      {charge.conta.nome}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">{charge.payerName}</td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={charge.status} />
                  </td>
                  <td className="py-3 pr-4">{formatCurrency(charge.value)}</td>
                  <td className="py-3 pr-4">{formatDate(charge.dueDate)}</td>
                  <td className="py-3 pr-4">{compactId(charge.asaasPaymentId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SupportPanel>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SupportPanel title="Assinaturas" description="Recorrências por matrícula e cobranças avulsas recorrentes.">
          <div className="space-y-3">
            {[...overview.subscriptions, ...overview.standaloneSubscriptions].slice(0, 12).map((item) => (
              <Link
                key={item.id}
                href={`/developer/contas/${item.contaId}/financeiro`}
                className="block rounded-md border border-slate-200 px-4 py-3 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-950">{item.conta.nome}</p>
                  <StatusBadge value={item.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{compactId(item.asaasSubscriptionId ?? item.id)}</p>
              </Link>
            ))}
          </div>
        </SupportPanel>

        <SupportPanel title="Parcelamentos" description="Planos internos e vínculos de installment no Asaas.">
          <div className="space-y-3">
            {[...overview.installmentPlans, ...overview.standaloneInstallments].slice(0, 12).map((item) => (
              <Link
                key={item.id}
                href={`/developer/contas/${item.contaId}/financeiro`}
                className="block rounded-md border border-slate-200 px-4 py-3 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-950">{item.conta.nome}</p>
                  <StatusBadge value={item.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{compactId(item.asaasInstallmentId ?? item.id)}</p>
              </Link>
            ))}
          </div>
        </SupportPanel>

        <SupportPanel title="Transferências e repasses" description="Pedidos de transferência com status local e snapshot Asaas.">
          <div className="space-y-3">
            {overview.transfers.slice(0, 12).map((item) => (
              <Link
                key={item.id}
                href={`/developer/contas/${item.contaId}/financeiro`}
                className="block rounded-md border border-slate-200 px-4 py-3 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-950">{item.conta.nome}</p>
                  <StatusBadge value={item.rawAsaasStatus ?? item.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatCurrency(item.value)} · {compactId(item.asaasTransferId ?? item.id)}
                </p>
              </Link>
            ))}
          </div>
        </SupportPanel>

        <SupportPanel title="Conciliação e divergências" description="Cobranças onde o snapshot Asaas diverge do estado local.">
          <div className="space-y-3">
            {overview.divergentCharges.slice(0, 12).map((item) => (
              <Link
                key={item.id}
                href={`/developer/contas/${item.contaId}/financeiro`}
                className="block rounded-md border border-amber-200 px-4 py-3 hover:bg-amber-50"
              >
                <p className="text-sm font-medium text-slate-950">{item.conta.nome}</p>
                <p className="mt-1 text-xs text-slate-600">
                  Local {item.status} · Asaas {item.asaasStatus} · {formatCurrency(item.valor)}
                </p>
              </Link>
            ))}
            {overview.integrationJobs.slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-md border border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-950">{item.type}</p>
                  <StatusBadge value={item.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {item.conta.nome} · tentativas {item.attempts} · próxima {formatDateTime(item.nextAttemptAt)}
                </p>
              </div>
            ))}
          </div>
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
