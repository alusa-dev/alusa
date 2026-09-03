import { notFound } from 'next/navigation';

import { requireAdminSessionForPage } from '@/lib/admin-session';
import { getSupportStudentDetail, listSupportNotes } from '@/features/support/queries/support-entities';
import { formatDateTime, formatSupportStatus, maskDocument, maskEmail, maskPhone } from '@/features/support/shared/format';
import { SupportCaseForm, SupportNoteForm } from '@/features/support/shared/SupportActionForms';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { RowLink, StatusBadge, SupportField, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportStudentDetailPage({ params }: { params: Promise<{ contaId: string; alunoId: string }> }) {
  const resolvedParams = await params;
  const session = await requireAdminSessionForPage(`/contas/${resolvedParams.contaId}/alunos/${resolvedParams.alunoId}`);
  const [student, notes] = await Promise.all([
    getSupportStudentDetail(resolvedParams.contaId, resolvedParams.alunoId),
    listSupportNotes({ contaId: resolvedParams.contaId, entityType: 'ALUNO', entityId: resolvedParams.alunoId }),
  ]);
  if (!student) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader title={student.nome} description="Dados mascarados, responsáveis e matrículas vinculadas." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <SupportPanel title="Dados do aluno">
            <div className="support-fields">
              <SupportField label="ID" value={student.id} />
              <SupportField label="CPF" value={maskDocument(student.cpf)} />
              <SupportField label="E-mail" value={maskEmail(student.email)} />
              <SupportField label="Telefone" value={maskPhone(student.telefone)} />
              <SupportField label="Status" value={formatSupportStatus(student.status)} />
              <SupportField label="Customer Asaas" value={student.asaasCustomerId ?? 'Não vinculado'} />
              <SupportField label="Atualizado em" value={formatDateTime(student.updatedAt)} />
            </div>
          </SupportPanel>
          <SupportPanel title="Matrículas">
            <div className="space-y-3">
              {student.matriculas.map((matricula) => (
                <RowLink
                  key={matricula.id}
                  href={`/contas/${resolvedParams.contaId}/matriculas/${matricula.id}`}
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
                  href={`/contas/${resolvedParams.contaId}/responsaveis/${link.responsavel.id}`}
                  title={link.responsavel.nome}
                  description={maskEmail(link.responsavel.email)}
                />
              ))}
            </div>
          </SupportPanel>
        </div>
        <div className="space-y-6">
          <SupportPanel title="Nota interna">
            <SupportNoteForm contaId={resolvedParams.contaId} entityType="ALUNO" entityId={student.id} />
          </SupportPanel>
          <SupportPanel title="Abrir caso">
            <SupportCaseForm contaId={resolvedParams.contaId} entityType="ALUNO" entityId={student.id} />
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
