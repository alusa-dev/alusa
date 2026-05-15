import { notFound } from 'next/navigation';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { getSupportChargeDetail, listSupportNotes } from '@/features/support/queries/support-entities';
import { compactId, formatCurrency, formatDate, formatDateTime } from '@/features/support/shared/format';
import { SupportCaseForm, SupportNoteForm, SupportSafeActionButton } from '@/features/support/shared/SupportActionForms';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { KeyValue, RowLink, StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportChargePage({ params }: { params: { contaId: string; chargeId: string } }) {
  const session = await requireGlobalAdminSessionForPage(`/developer/contas/${params.contaId}/financeiro/cobrancas/${params.chargeId}`);
  const [charge, notes] = await Promise.all([
    getSupportChargeDetail(params.contaId, params.chargeId),
    listSupportNotes({ contaId: params.contaId, entityType: 'CHARGE', entityId: params.chargeId }),
  ]);
  if (!charge) notFound();

  const read = charge.readModel;

  return (
    <SupportShell session={session}>
      <SupportPageHeader eyebrow="Cobrança" title={read.payerName} description="Diagnóstico local, Asaas, jobs e webhooks relacionados." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <SupportPanel title="Read model">
            <dl>
              <KeyValue label="ID" value={read.id} />
              <KeyValue label="Status" value={<StatusBadge value={read.status} />} />
              <KeyValue label="Valor" value={formatCurrency(read.value)} />
              <KeyValue label="Vencimento" value={formatDate(read.dueDate)} />
              <KeyValue label="Origem" value={`${read.origin} · ${read.sourceKind}`} />
              <KeyValue label="Tipo" value={read.chargeType} />
              <KeyValue label="Payment Asaas" value={read.asaasPaymentId ?? 'Sem paymentId'} />
              <KeyValue label="Matrícula" value={read.matriculaId ?? 'Sem vínculo'} />
            </dl>
          </SupportPanel>
          <SupportPanel title="Estado acadêmico local">
            {charge.localCharge ? (
              <dl>
                <KeyValue label="Status local" value={<StatusBadge value={charge.localCharge.status} />} />
                <KeyValue label="Status Asaas local" value={<StatusBadge value={charge.localCharge.asaasStatus} />} />
                <KeyValue label="Valor local" value={formatCurrency(charge.localCharge.valor)} />
                <KeyValue label="Valor Asaas" value={formatCurrency(charge.localCharge.asaasValue)} />
                <KeyValue label="Líquido Asaas" value={formatCurrency(charge.localCharge.asaasNetValue)} />
                <KeyValue label="Último GET Asaas" value={formatDateTime(charge.localCharge.lastAsaasFetchAt)} />
                <KeyValue label="Liquidação" value={<StatusBadge value={charge.localCharge.liquidacaoStatus} />} />
              </dl>
            ) : (
              <p className="text-sm text-slate-500">Cobrança sem registro acadêmico local vinculado.</p>
            )}
          </SupportPanel>
          <SupportPanel title="Webhooks relacionados">
            <div className="space-y-3">
              {charge.webhooks.map((webhook) => (
                <RowLink
                  key={webhook.id}
                  href={`/developer/contas/${params.contaId}/webhooks/${webhook.id}`}
                  title={webhook.evento}
                  description={webhook.eventId ?? compactId(webhook.id)}
                  meta={<StatusBadge value={webhook.status} />}
                />
              ))}
            </div>
          </SupportPanel>
        </div>
        <div className="space-y-6">
          <SupportPanel title="Ações seguras">
            <div className="space-y-3">
              <SupportSafeActionButton
                label="Rodar reconciliação individual"
                endpoint="/api/developer/actions/reconcile-charge"
                payload={{ contaId: params.contaId, chargeId: params.chargeId }}
              />
              <SupportSafeActionButton
                label="Consultar status Asaas"
                endpoint="/api/developer/actions/check-asaas-status"
                payload={{ contaId: params.contaId, chargeId: params.chargeId }}
              />
              <SupportSafeActionButton
                label="Obter links oficiais"
                endpoint="/api/developer/actions/refresh-charge-links"
                payload={{ contaId: params.contaId, chargeId: params.chargeId }}
              />
              <SupportSafeActionButton
                label="Marcar divergência"
                endpoint="/api/developer/actions/divergence"
                payload={{ contaId: params.contaId, entityType: 'CHARGE', entityId: read.id }}
              />
            </div>
          </SupportPanel>
          <SupportPanel title="Nota interna">
            <SupportNoteForm contaId={params.contaId} entityType="CHARGE" entityId={read.id} />
          </SupportPanel>
          <SupportPanel title="Abrir caso">
            <SupportCaseForm contaId={params.contaId} entityType="CHARGE" entityId={read.id} />
          </SupportPanel>
        </div>
      </div>
      <div className="mt-6">
        <SupportPanel title="Notas recentes">
          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm">{note.body}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {note.authorName ?? 'Suporte'} · {formatDateTime(note.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
