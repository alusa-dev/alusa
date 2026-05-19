import { notFound } from 'next/navigation';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { getSupportResponsavelDetail, listSupportNotes } from '@/features/support/queries/support-entities';
import { formatDateTime, maskDocument, maskEmail, maskPhone } from '@/features/support/shared/format';
import { SupportCaseForm, SupportNoteForm } from '@/features/support/shared/SupportActionForms';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { KeyValue, RowLink, StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportResponsavelPage({ params }: { params: Promise<{ contaId: string; responsavelId: string }> }) {
  const resolvedParams = await params;
  const session = await requireGlobalAdminSessionForPage(`/developer/contas/${resolvedParams.contaId}/responsaveis/${resolvedParams.responsavelId}`);
  const [responsavel, notes] = await Promise.all([
    getSupportResponsavelDetail(resolvedParams.contaId, resolvedParams.responsavelId),
    listSupportNotes({ contaId: resolvedParams.contaId, entityType: 'RESPONSAVEL', entityId: resolvedParams.responsavelId }),
  ]);
  if (!responsavel) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader eyebrow="Responsável" title={responsavel.nome} description="Dados de pagador e vínculos com alunos." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <SupportPanel title="Dados do responsável">
            <dl>
              <KeyValue label="ID" value={responsavel.id} />
              <KeyValue label="CPF" value={maskDocument(responsavel.cpf)} />
              <KeyValue label="E-mail" value={maskEmail(responsavel.email)} />
              <KeyValue label="Telefone" value={maskPhone(responsavel.telefone)} />
              <KeyValue label="Responsável financeiro" value={responsavel.financeiro ? 'Sim' : 'Não'} />
              <KeyValue label="Customer Asaas" value={responsavel.asaasCustomerId ?? 'Não vinculado'} />
              <KeyValue label="Cartão" value={responsavel.creditCardLast4 ? `${responsavel.creditCardBrand ?? 'Cartão'} final ${responsavel.creditCardLast4}` : 'Não cadastrado'} />
            </dl>
          </SupportPanel>
          <SupportPanel title="Alunos vinculados">
            <div className="space-y-3">
              {responsavel.alunos.map((item) => (
                <RowLink
                  key={item.aluno.id}
                  href={`/developer/contas/${resolvedParams.contaId}/alunos/${item.aluno.id}`}
                  title={item.aluno.nome}
                  description={item.tipoVinculo}
                  meta={<StatusBadge value={item.aluno.status} />}
                />
              ))}
            </div>
          </SupportPanel>
        </div>
        <div className="space-y-6">
          <SupportPanel title="Nota interna">
            <SupportNoteForm contaId={resolvedParams.contaId} entityType="RESPONSAVEL" entityId={responsavel.id} />
          </SupportPanel>
          <SupportPanel title="Abrir caso">
            <SupportCaseForm contaId={resolvedParams.contaId} entityType="RESPONSAVEL" entityId={responsavel.id} />
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
