import { notFound } from 'next/navigation';
import Link from 'next/link';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import {
  getSupportAccount,
  getSupportWebhookAdvanced,
  listSupportWebhooks,
} from '@/features/support/queries/support-account';
import { compactId, formatDateTime } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { StatusBadge, SupportMetric, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportAccountWebhooksPage({
  params,
}: {
  params: Promise<{ contaId: string }>;
}) {
  const resolvedParams = await params;
  const session = await requireGlobalAdminSessionForPage(
    `/developer/contas/${resolvedParams.contaId}/webhooks`,
  );
  const [account, webhooks, advanced] = await Promise.all([
    getSupportAccount(resolvedParams.contaId),
    listSupportWebhooks(resolvedParams.contaId),
    getSupportWebhookAdvanced(resolvedParams.contaId),
  ]);
  if (!account) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Webhooks"
        title={`Eventos Asaas de ${account.conta.nome}`}
        description="Eventos recebidos, arquivados, rejeitados, tentativas, erro normalizado e correlação com IDs Asaas."
      />

      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <SupportMetric label="Recebidos" value={advanced.active.length} />
        <SupportMetric label="Arquivados" value={advanced.archived.length} />
        <SupportMetric label="Rejeitados" value={advanced.rejected.length} tone="warning" />
        <SupportMetric
          label="Com erro"
          value={advanced.active.filter((item) => ['ERRO', 'ERROR', 'FAILED'].includes(item.status)).length}
          tone="danger"
        />
      </div>

      <SupportPanel title="Eventos recentes" description={`${webhooks.length} registros recentes`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-3 pr-4">Evento</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Recebido</th>
                <th className="py-3 pr-4">Processado</th>
                <th className="py-3 pr-4">Tentativas</th>
                <th className="py-3 pr-4">Correlação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {webhooks.map((webhook) => (
                <tr key={webhook.id}>
                  <td className="py-3 pr-4">
                    <Link
                      className="font-medium text-slate-950 hover:underline"
                      href={`/developer/contas/${resolvedParams.contaId}/webhooks/${webhook.id}`}
                    >
                      {webhook.evento}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={webhook.status} />
                  </td>
                  <td className="py-3 pr-4">{formatDateTime(webhook.recebidoEm)}</td>
                  <td className="py-3 pr-4">{formatDateTime(webhook.processadoEm)}</td>
                  <td className="py-3 pr-4">{webhook.tentativas}</td>
                  <td className="py-3 pr-4">
                    {compactId(
                      webhook.asaasPaymentId ??
                        webhook.asaasSubscriptionId ??
                        webhook.asaasTransferId ??
                        webhook.eventId,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SupportPanel>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SupportPanel title="Arquivados" description="Eventos preservados para auditoria técnica.">
          <div className="space-y-3">
            {advanced.archived.map((item) => (
              <div key={item.id} className="rounded-md border border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-950">{item.evento}</p>
                  <StatusBadge value={item.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">Arquivado {formatDateTime(item.archivedAt)}</p>
              </div>
            ))}
          </div>
        </SupportPanel>

        <SupportPanel title="Rejeitados / DLQ" description="Eventos que não entraram no fluxo normal.">
          <div className="space-y-3">
            {advanced.rejected.map((item) => (
              <div key={item.id} className="rounded-md border border-amber-200 px-4 py-3">
                <p className="text-sm font-medium text-slate-950">{item.evento}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {item.reason} · recebido {formatDateTime(item.recebidoEm)}
                </p>
              </div>
            ))}
          </div>
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
