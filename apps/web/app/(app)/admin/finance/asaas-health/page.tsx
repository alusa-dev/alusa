import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth-options';
import {
  getAsaasTenantHealth,
  getWebhookConfigDriftStatus,
  getWebhookOperationalDiagnostics,
} from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function boolLabel(value: boolean | null | undefined) {
  return value ? 'Sim' : 'Não';
}

function row(label: string, value: string | number | null | undefined) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">{value ?? '—'}</span>
    </div>
  );
}

export default async function AdminFinanceAsaasHealthPage() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user;
  if (!user?.contaId || !['ADMIN', 'SUPER_ADMIN'].includes(user.role ?? '')) redirect('/admin/configuracoes');

  const [tenantHealth, drift, diagnostics] = await Promise.all([
    getAsaasTenantHealth(user.contaId),
    getWebhookConfigDriftStatus(user.contaId).catch(() => null),
    getWebhookOperationalDiagnostics({ contaId: user.contaId, includeGaps: false }).catch(() => null),
  ]);

  return (
    <main className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Saúde Asaas</h1>
          <p className="mt-1 text-sm text-slate-600">Status operacional: {tenantHealth.operationalStatus ?? '—'}</p>
        </div>
        <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800" href="/admin/finance/webhooks">
          Webhooks
        </Link>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-950">Conta</h2>
          <div className="mt-3">
            {row('Subconta', tenantHealth.asaasAccountId)}
            {row('API key conectada', boolLabel(tenantHealth.apiKeyConnected))}
            {row('Webhook ativo', boolLabel(tenantHealth.webhookActive))}
            {row('Webhook local', tenantHealth.webhookStatus)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-950">Webhook remoto</h2>
          <div className="mt-3">
            {row('Encontrado', boolLabel(Boolean(drift?.remote.webhookId)))}
            {row('Habilitado', boolLabel(drift?.remote.enabled))}
            {row('Interrompido', boolLabel(drift?.remote.interrupted))}
            {row('Auth token', boolLabel(drift?.remote.hasAuthToken))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-950">Fila</h2>
          <div className="mt-3">
            {row('Status', diagnostics?.status)}
            {row('Backlog', diagnostics?.queue.backlog)}
            {row('Erro', diagnostics?.queue.errored)}
            {row('Exauridos', diagnostics?.queue.exhausted)}
          </div>
        </div>
      </section>

      {diagnostics?.recommendations.length ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-950">Recomendações</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {diagnostics.recommendations.map((item) => (
              <li key={item.code} className="py-3 text-sm text-slate-700">
                <span className="font-medium text-slate-950">{item.severity.toUpperCase()}</span> · {item.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
