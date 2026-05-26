import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth-options';
import {
  getFinanceReconciliationIssueSummary,
  listFinanceReconciliationIssues,
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

function countMapValue(map: Record<string, number>, key: string) {
  return map[key] ?? 0;
}

export default async function AdminFinanceReconciliationPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user;
  if (!user?.contaId || !['ADMIN', 'SUPER_ADMIN'].includes(user.role ?? '')) redirect('/admin/configuracoes');

  const [summary, issues] = await Promise.all([
    getFinanceReconciliationIssueSummary(user.contaId),
    listFinanceReconciliationIssues({ contaId: user.contaId, status: 'OPEN', pageSize: 25 }),
  ]);

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Reconciliação financeira</h1>
          <p className="mt-1 text-sm text-slate-600">{issues.total} divergência(s) aberta(s)</p>
        </div>
        <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800" href="/admin/finance/webhooks">
          Webhooks
        </Link>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        {[
          ['Críticas', countMapValue(summary.openBySeverity, 'CRITICAL')],
          ['Altas', countMapValue(summary.openBySeverity, 'HIGH')],
          ['Médias', countMapValue(summary.openBySeverity, 'MEDIUM')],
          ['Needs review', summary.needsReview],
          ['Webhook drift', summary.webhookDrift],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Severidade</th>
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3">Local</th>
                <th className="px-4 py-3">Remoto</th>
                <th className="px-4 py-3">Última ocorrência</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {issues.items.map((issue) => (
                <tr key={issue.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{issue.issueType}</td>
                  <td className="px-4 py-3 text-slate-700">{issue.severity}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {issue.entityType}:{issue.entityId ?? issue.asaasId ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{issue.localStatus ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{issue.remoteStatus ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{formatDate(issue.lastSeenAt)}</td>
                </tr>
              ))}
              {issues.items.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>Sem divergências abertas.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
