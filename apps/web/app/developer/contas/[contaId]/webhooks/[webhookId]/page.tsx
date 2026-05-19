import { notFound } from 'next/navigation';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { getSupportWebhookDetail, listSupportNotes } from '@/features/support/queries/support-entities';
import { compactId, formatDateTime } from '@/features/support/shared/format';
import { SupportCaseForm, SupportNoteForm, SupportSafeActionButton } from '@/features/support/shared/SupportActionForms';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { KeyValue, StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[520px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function SupportWebhookDetailPage({
  params,
}: {
  params: Promise<{ contaId: string; webhookId: string }>;
}) {
  const resolvedParams = await params;
  const session = await requireGlobalAdminSessionForPage(
    `/developer/contas/${resolvedParams.contaId}/webhooks/${resolvedParams.webhookId}`,
  );
  const [webhook] = await Promise.all([
    getSupportWebhookDetail(resolvedParams.contaId, resolvedParams.webhookId),
    listSupportNotes({ contaId: resolvedParams.contaId, entityType: 'WEBHOOK', entityId: resolvedParams.webhookId }),
  ]);
  if (!webhook) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Webhook"
        title={webhook.evento}
        description="Payload mascarado, tentativas e ação de replay individual auditada."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <SupportPanel title="Resumo do evento">
            <dl>
              <KeyValue label="ID" value={webhook.id} />
              <KeyValue label="Event ID" value={webhook.eventId ?? 'Sem eventId'} />
              <KeyValue label="Status" value={<StatusBadge value={webhook.status} />} />
              <KeyValue label="Recebido em" value={formatDateTime(webhook.recebidoEm)} />
              <KeyValue label="Processado em" value={formatDateTime(webhook.processadoEm)} />
              <KeyValue label="Tentativas" value={webhook.tentativas} />
              <KeyValue label="Erro" value={webhook.ultimoErro ?? 'Sem erro'} />
              <KeyValue
                label="Correlação"
                value={compactId(webhook.asaasPaymentId ?? webhook.asaasSubscriptionId ?? webhook.asaasTransferId)}
              />
            </dl>
          </SupportPanel>
          <SupportPanel title="Payload mascarado">
            <JsonBlock value={webhook.payload} />
          </SupportPanel>
          <SupportPanel title="Attempts log">
            <JsonBlock value={webhook.attemptsLog ?? []} />
          </SupportPanel>
        </div>
        <div className="space-y-6">
          <SupportPanel title="Ações seguras">
            <SupportSafeActionButton
              label="Reprocessar webhook"
              endpoint="/api/developer/actions/replay-webhook"
              payload={{ contaId: resolvedParams.contaId, webhookId: resolvedParams.webhookId }}
            />
          </SupportPanel>
          <SupportPanel title="Nota interna">
            <SupportNoteForm contaId={resolvedParams.contaId} entityType="WEBHOOK" entityId={webhook.id} />
          </SupportPanel>
          <SupportPanel title="Abrir caso">
            <SupportCaseForm contaId={resolvedParams.contaId} entityType="WEBHOOK" entityId={webhook.id} />
          </SupportPanel>
        </div>
      </div>
    </SupportShell>
  );
}
