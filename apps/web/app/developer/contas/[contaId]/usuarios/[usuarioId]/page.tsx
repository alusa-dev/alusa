import { notFound } from 'next/navigation';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { getSupportUserDetail, listSupportNotes } from '@/features/support/queries/support-entities';
import { formatDateTime, maskEmail, maskPhone } from '@/features/support/shared/format';
import { SupportNoteForm } from '@/features/support/shared/SupportActionForms';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { KeyValue, StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportUserDetailPage({
  params,
}: {
  params: Promise<{ contaId: string; usuarioId: string }>;
}) {
  const resolvedParams = await params;
  const session = await requireGlobalAdminSessionForPage(
    `/developer/contas/${resolvedParams.contaId}/usuarios/${resolvedParams.usuarioId}`,
  );
  const [user, notes] = await Promise.all([
    getSupportUserDetail(resolvedParams.contaId, resolvedParams.usuarioId),
    listSupportNotes({ contaId: resolvedParams.contaId, entityType: 'USUARIO', entityId: resolvedParams.usuarioId }),
  ]);
  if (!user) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader eyebrow="Usuário" title={user.nome} description="Detalhe de acesso e vínculos da conta." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <SupportPanel title="Dados do usuário">
          <dl>
            <KeyValue label="ID" value={user.id} />
            <KeyValue label="E-mail" value={maskEmail(user.email)} />
            <KeyValue label="Telefone" value={maskPhone(user.telefone)} />
            <KeyValue label="Papel legado" value={<StatusBadge value={user.role} />} />
            <KeyValue label="Status" value={<StatusBadge value={user.status} />} />
            <KeyValue label="E-mail verificado" value={formatDateTime(user.emailVerifiedAt)} />
            <KeyValue label="Atualizado em" value={formatDateTime(user.updatedAt)} />
          </dl>
        </SupportPanel>
        <SupportPanel title="Ações seguras">
          <SupportNoteForm contaId={resolvedParams.contaId} entityType="USUARIO" entityId={user.id} />
        </SupportPanel>
      </div>
      <div className="mt-6">
        <SupportPanel title="Notas internas">
          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm text-slate-900">{note.body}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {note.authorName} · {formatDateTime(note.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
