import { notFound } from 'next/navigation';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { getSupportEnrollmentDetail } from '@/features/support/queries/support-entities';
import { formatCurrency, formatDate, maskEmail } from '@/features/support/shared/format';
import { SupportCaseForm, SupportNoteForm } from '@/features/support/shared/SupportActionForms';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { KeyValue, RowLink, StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportEnrollmentPage({ params }: { params: Promise<{ contaId: string; matriculaId: string }> }) {
  const resolvedParams = await params;
  const session = await requireGlobalAdminSessionForPage(`/developer/contas/${resolvedParams.contaId}/matriculas/${resolvedParams.matriculaId}`);
  const matricula = await getSupportEnrollmentDetail(resolvedParams.contaId, resolvedParams.matriculaId);
  if (!matricula) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader eyebrow="Matrícula" title={matricula.aluno.nome} description="Contrato, financeiro e cobranças vinculadas." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <SupportPanel title="Dados da matrícula">
            <dl>
              <KeyValue label="ID" value={matricula.id} />
              <KeyValue label="Aluno" value={matricula.aluno.nome} />
              <KeyValue label="Responsável financeiro" value={matricula.responsavelFinanceiro ? `${matricula.responsavelFinanceiro.nome} · ${maskEmail(matricula.responsavelFinanceiro.email)}` : 'Não definido'} />
              <KeyValue label="Status" value={<StatusBadge value={matricula.status} />} />
              <KeyValue label="Financeiro" value={<StatusBadge value={matricula.statusFinanceiro} />} />
              <KeyValue label="Contrato" value={<StatusBadge value={matricula.statusContrato} />} />
              <KeyValue label="Taxa" value={`${formatCurrency(matricula.taxaMatricula)} · ${matricula.taxaStatus}`} />
              <KeyValue label="Assinatura Asaas" value={matricula.asaasSubscriptionId ?? 'Sem assinatura'} />
              <KeyValue label="Início" value={formatDate(matricula.dataInicio)} />
              <KeyValue label="Fim contrato" value={formatDate(matricula.dataFimContrato)} />
            </dl>
          </SupportPanel>
          <SupportPanel title="Cobranças da matrícula">
            <div className="space-y-3">
              {matricula.cobrancas.map((charge) => (
                <RowLink
                  key={charge.id}
                  href={`/developer/contas/${resolvedParams.contaId}/financeiro/cobrancas/${charge.asaasPaymentId ?? charge.id}`}
                  title={charge.id}
                  description={`${formatCurrency(charge.valor)} · vence ${formatDate(charge.vencimento)}`}
                  meta={<StatusBadge value={charge.asaasStatus ?? charge.status} />}
                />
              ))}
            </div>
          </SupportPanel>
        </div>
        <div className="space-y-6">
          <SupportPanel title="Nota interna">
            <SupportNoteForm contaId={resolvedParams.contaId} entityType="MATRICULA" entityId={matricula.id} />
          </SupportPanel>
          <SupportPanel title="Abrir caso">
            <SupportCaseForm contaId={resolvedParams.contaId} entityType="MATRICULA" entityId={matricula.id} />
          </SupportPanel>
        </div>
      </div>
    </SupportShell>
  );
}
