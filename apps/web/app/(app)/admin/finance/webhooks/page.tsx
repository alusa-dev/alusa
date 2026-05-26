import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth-options';
import {
  getAsaasWebhookOperationalStatus,
  getFinanceReconciliationIssueSummary,
  listWebhooks,
} from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function metric(label: string, value: string | number) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value}</p>
    </div>
  );
}

export default async function AdminFinanceWebhooksPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user;
  if (!user?.contaId || !['ADMIN', 'SUPER_ADMIN'].includes(user.role ?? '')) redirect('/admin/configuracoes');

  const [status, webhooks, issueSummary] = await Promise.all([
    getAsaasWebhookOperationalStatus({ contaId: user.contaId }),
    listWebhooks(user.contaId, { pageSize: 12 }),
    getFinanceReconciliationIssueSummary(user.contaId),
  ]);

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Webhooks financeiros</h1>
          <p className="mt-1 text-sm text-slate-600">Última leitura: {formatDate(status.generatedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white" href="/admin/finance/reconciliation">
            Divergências
          </Link>
          <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800" href="/admin/finance/asaas-health">
            Saúde Asaas
          </Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        {metric('Backlog', status.pending + status.processing + status.errored)}
        {metric('Pendentes', status.pending)}
        {metric('Erro', status.errored)}
        {metric('Exauridos', status.exhausted)}
        {metric('Lag', status.lagSeconds === null ? '—' : `${Math.floor(status.lagSeconds / 60)} min`)}
        {metric('Processados 24h', status.processedLast24h)}
        {metric('Rejeições 24h', status.rejectionCountLast24h)}
        {metric('Needs review', issueSummary.needsReview)}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-950">Eventos recentes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Evento</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recebido</th>
                <th className="px-4 py-3">Tentativas</th>
                <th className="px-4 py-3">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {webhooks.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{item.evento}</td>
                  <td className="px-4 py-3 text-slate-700">{item.status}</td>
                  <td className="px-4 py-3 text-slate-700">{formatDate(item.recebidoEm)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{item.tentativas}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.asaasPaymentId ?? '—'}</td>
                </tr>
              ))}
              {webhooks.items.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>Sem eventos no período.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
