import { notFound } from 'next/navigation';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { getSupportStudentDetail, listSupportNotes } from '@/features/support/queries/support-entities';
import { formatDateTime, maskDocument, maskEmail, maskPhone } from '@/features/support/shared/format';
import { SupportCaseForm, SupportNoteForm } from '@/features/support/shared/SupportActionForms';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { KeyValue, RowLink, StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportStudentDetailPage({ params }: { params: { contaId: string; alunoId: string } }) {
  const session = await requireGlobalAdminSessionForPage(`/developer/contas/${params.contaId}/alunos/${params.alunoId}`);
  const [student, notes] = await Promise.all([
    getSupportStudentDetail(params.contaId, params.alunoId),
    listSupportNotes({ contaId: params.contaId, entityType: 'ALUNO', entityId: params.alunoId }),
  ]);
  if (!student) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader eyebrow="Aluno" title={student.nome} description="Dados mascarados, responsáveis e matrículas vinculadas." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <SupportPanel title="Dados do aluno">
            <dl>
              <KeyValue label="ID" value={student.id} />
              <KeyValue label="CPF" value={maskDocument(student.cpf)} />
              <KeyValue label="E-mail" value={maskEmail(student.email)} />
              <KeyValue label="Telefone" value={maskPhone(student.telefone)} />
              <KeyValue label="Status" value={<StatusBadge value={student.status} />} />
              <KeyValue label="Customer Asaas" value={student.asaasCustomerId ?? 'Não vinculado'} />
              <KeyValue label="Atualizado em" value={formatDateTime(student.updatedAt)} />
            </dl>
          </SupportPanel>
          <SupportPanel title="Matrículas">
            <div className="space-y-3">
              {student.matriculas.map((matricula) => (
                <RowLink
                  key={matricula.id}
                  href={`/developer/contas/${params.contaId}/matriculas/${matricula.id}`}
                  title={matricula.id}
                  description={formatDateTime(matricula.createdAt)}
                  meta={<StatusBadge value={`${matricula.status} · ${matricula.statusFinanceiro}`} />}
                />
              ))}
            </div>
          </SupportPanel>
          <SupportPanel title="Responsáveis">
            <div className="space-y-3">
              {student.responsaveis.map((link) => (
                <RowLink
                  key={link.responsavel.id}
                  href={`/developer/contas/${params.contaId}/responsaveis/${link.responsavel.id}`}
                  title={link.responsavel.nome}
                  description={maskEmail(link.responsavel.email)}
                />
              ))}
            </div>
          </SupportPanel>
        </div>
        <div className="space-y-6">
          <SupportPanel title="Nota interna">
            <SupportNoteForm contaId={params.contaId} entityType="ALUNO" entityId={student.id} />
          </SupportPanel>
          <SupportPanel title="Abrir caso">
            <SupportCaseForm contaId={params.contaId} entityType="ALUNO" entityId={student.id} />
          </SupportPanel>
        </div>
      </div>
      <div className="mt-6">
        <SupportPanel title="Notas recentes">
          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm">{note.body}</p>
                <p className="mt-2 text-xs text-slate-500">{note.authorName} · {formatDateTime(note.createdAt)}</p>
              </div>
            ))}
          </div>
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
