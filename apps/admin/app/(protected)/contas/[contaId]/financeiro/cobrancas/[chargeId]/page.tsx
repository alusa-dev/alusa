import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/icons/Icon';
import { requireAdminSessionForPage } from '@/lib/admin-session';
import { getSupportChargeDetail, listSupportNotes } from '@/features/support/queries/support-entities';
import {
  compactId,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatSupportStatus,
  supportChargeTitle,
} from '@/features/support/shared/format';
import { SupportCaseForm, SupportNoteForm, SupportSafeActionButton } from '@/features/support/shared/SupportActionForms';
import { SupportShell } from '@/features/support/shared/SupportShell';
import {
  EmptyState,
  StatusBadge,
  SupportField,
  SupportPageHeader,
  SupportPanel,
} from '@/features/support/shared/SupportUI';

export default async function SupportChargePage({ params }: { params: Promise<{ contaId: string; chargeId: string }> }) {
  const resolvedParams = await params;
  const session = await requireAdminSessionForPage(`/contas/${resolvedParams.contaId}/financeiro/cobrancas/${resolvedParams.chargeId}`);
  const [charge, notes] = await Promise.all([
    getSupportChargeDetail(resolvedParams.contaId, resolvedParams.chargeId),
    listSupportNotes({ contaId: resolvedParams.contaId, entityType: 'CHARGE', entityId: resolvedParams.chargeId }),
  ]);
  if (!charge) notFound();

  const read = charge.readModel;
  const chargeTitle = supportChargeTitle(read);

  return (
    <SupportShell session={session}>
      <div className="admin-detail account-charge-detail">
        <Link className="account-detail-back" href={`/contas/${resolvedParams.contaId}`}>
          <Icon name="ChevronRight" size={16} className="account-detail-back-icon" aria-hidden="true" />
          Visão da conta
        </Link>

        <div className="account-charge-heading">
          <SupportPageHeader title={chargeTitle} description="Consulte os dados da cobrança, a integração e o histórico de processamento." />
          <StatusBadge value={read.status} />
        </div>

        <SupportPanel title="Resumo da cobrança" description="Identificação e situação atual do registro financeiro.">
          <div className="support-fields">
            <SupportField label="ID da cobrança" value={read.id} />
            <SupportField label="Status" value={formatSupportStatus(read.status)} />
            <SupportField label="Valor" value={formatCurrency(read.value)} />
            <SupportField label="Vencimento" value={formatDate(read.dueDate)} />
            <SupportField label="Pagador" value={read.payerName ?? 'Não informado'} />
            <SupportField label="Descrição" value={read.description ?? 'Não informada'} />
          </div>
        </SupportPanel>

        <SupportPanel title="Vínculos e origem" description="Relações acadêmicas e origem da cobrança na Alusa.">
          <div className="support-fields">
            <SupportField label="Tipo" value={formatSupportStatus(read.chargeType)} />
            <SupportField label="Forma de pagamento" value={formatSupportStatus(read.billingType)} />
            <SupportField label="Origem" value={`${formatSupportStatus(read.origin)} · ${formatSupportStatus(read.sourceKind)}`} />
            <SupportField label="Status do vínculo" value={formatSupportStatus(read.linkStatus)} />
            <SupportField label="Matrícula" value={read.matriculaId ?? 'Sem vínculo'} />
            <SupportField label="Aluno" value={read.alunoId ?? 'Sem vínculo'} />
            <SupportField label="Parcela" value={read.installmentCount ? `${read.installmentsPaid ?? 0} de ${read.installmentCount}` : 'Não aplicável'} />
            <SupportField label="Criada em" value={formatDateTime(read.createdAt)} />
          </div>
        </SupportPanel>

        <SupportPanel title="Integração com o Asaas" description="Identificadores e estado financeiro sincronizado.">
          <div className="support-fields">
            <SupportField label="Payment ID Asaas" value={read.asaasPaymentId ?? 'Sem paymentId'} />
            <SupportField label="ID de origem" value={read.sourceId ?? 'Sem origem'} />
            <SupportField label="Última atualização local" value={formatDateTime(read.updatedAt)} />
            {charge.localCharge ? (
              <>
                <SupportField label="Status Asaas local" value={formatSupportStatus(charge.localCharge.asaasStatus)} />
                <SupportField label="Valor Asaas" value={formatCurrency(charge.localCharge.asaasValue)} />
                <SupportField label="Valor líquido Asaas" value={formatCurrency(charge.localCharge.asaasNetValue)} />
                <SupportField label="Última consulta ao Asaas" value={formatDateTime(charge.localCharge.lastAsaasFetchAt)} />
                <SupportField label="Liquidação" value={formatSupportStatus(charge.localCharge.liquidacaoStatus)} />
              </>
            ) : null}
          </div>
          {!charge.localCharge ? <p className="account-charge-muted">Não há registro acadêmico local vinculado a esta cobrança.</p> : null}
        </SupportPanel>

        <SupportPanel title="Webhooks relacionados" description="Eventos que podem ter alterado ou confirmado o estado da cobrança.">
          {charge.webhooks.length > 0 ? (
            <div className="account-charge-record-list">
              {charge.webhooks.map((webhook) => (
                <Link key={webhook.id} className="account-charge-record" href={`/contas/${resolvedParams.contaId}/webhooks/${webhook.id}`}>
                  <span><strong>{webhook.evento}</strong><small>{webhook.eventId ?? compactId(webhook.id)} · {formatDateTime(webhook.recebidoEm)}</small></span>
                  <StatusBadge value={webhook.status} />
                </Link>
              ))}
            </div>
          ) : <EmptyState title="Nenhum webhook relacionado" description="Os eventos vinculados a esta cobrança aparecerão aqui." />}
        </SupportPanel>

        <SupportPanel title="Processamento" description="Jobs de integração relacionados a esta cobrança.">
          {charge.jobs.length > 0 ? (
            <div className="account-charge-record-list">
              {charge.jobs.map((job) => (
                <div key={job.id} className="account-charge-record account-charge-record-static">
                  <span><strong>{formatSupportStatus(job.type)}</strong><small>{job.attempts} tentativa(s) · {formatDateTime(job.createdAt)}</small></span>
                  <StatusBadge value={job.status} />
                </div>
              ))}
            </div>
          ) : <EmptyState title="Nenhum processamento registrado" description="Os jobs desta cobrança aparecerão aqui quando forem executados." />}
        </SupportPanel>

        <SupportPanel title="Ações de suporte" description="Consultas e correções operacionais com registro de auditoria.">
          <div className="account-charge-actions">
            <SupportSafeActionButton label="Consultar status no Asaas" endpoint="/api/admin/actions/check-asaas-status" payload={{ contaId: resolvedParams.contaId, chargeId: resolvedParams.chargeId }} />
            <SupportSafeActionButton label="Rodar reconciliação individual" endpoint="/api/admin/actions/reconcile-charge" payload={{ contaId: resolvedParams.contaId, chargeId: resolvedParams.chargeId }} />
            <SupportSafeActionButton label="Atualizar links oficiais" endpoint="/api/admin/actions/refresh-charge-links" payload={{ contaId: resolvedParams.contaId, chargeId: resolvedParams.chargeId }} />
            <SupportSafeActionButton label="Abrir divergência" endpoint="/api/admin/actions/divergence" payload={{ contaId: resolvedParams.contaId, entityType: 'CHARGE', entityId: read.id }} />
          </div>
        </SupportPanel>

        <SupportPanel title="Nota interna" description="Registre contexto para o acompanhamento da equipe.">
          <SupportNoteForm contaId={resolvedParams.contaId} entityType="CHARGE" entityId={read.id} />
        </SupportPanel>

        <SupportPanel title="Abrir caso" description="Use quando a cobrança precisar de acompanhamento manual.">
          <SupportCaseForm contaId={resolvedParams.contaId} entityType="CHARGE" entityId={read.id} />
        </SupportPanel>

        <SupportPanel title="Notas recentes" description={`${notes.length} registros de suporte para esta cobrança.`}>
          {notes.length > 0 ? (
            <div className="account-charge-notes">
              {notes.map((note) => (
                <div key={note.id} className="account-charge-note">
                  <p>{note.body}</p>
                  <small>{note.authorName ?? 'Suporte'} · {formatDateTime(note.createdAt)}</small>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Nenhuma nota registrada" description="As notas internas desta cobrança aparecerão aqui." />}
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
