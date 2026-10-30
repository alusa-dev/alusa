import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@alusa/database';
import { requireAdminSessionForPage } from '@/lib/admin-session';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { InvitationEditor } from '@/features/school-invitations/InvitationEditor';
import { InvitationResender } from '@/features/school-invitations/InvitationResender';
import { hasSupportRoleAccess } from '@/features/support/auth/permissions';

export default async function CommercialInvitationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdminSessionForPage(`/convites/${id}`);
  if (!hasSupportRoleAccess(session, ['SUPPORT_ADMIN', 'SUPPORT_FINANCE'], 'admin-school-invitations')) notFound();
  const invitation = await prisma.platformSchoolInvitation.findUnique({ where: { id }, include: { history: { orderBy: { createdAt: 'desc' } }, conditionVersions: { orderBy: { version: 'desc' } } } });
  if (!invitation) notFound();
  const billing = invitation.acceptedContaId ? await prisma.platformBillingAccount.findFirst({ where: { contaId: invitation.acceptedContaId }, select: { id: true } }) : null;
  const canEditCondition = invitation.status === 'PENDING' || (invitation.status === 'ACCEPTED' && !billing);
  return <SupportShell session={session}><main className="mx-auto grid max-w-5xl gap-6 px-6 py-8">
    <Link href="/convites" className="text-sm text-violet-800 underline">← Voltar aos convites</Link>
    <header><h1 className="text-2xl font-semibold">{invitation.schoolName}</h1><p className="text-sm text-slate-600">{invitation.email} · {invitation.status} · {invitation.expiresAt.toLocaleString('pt-BR')}</p></header>
    <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 text-lg font-semibold">Condição acordada · versão {invitation.currentConditionVersion}</h2><dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div><dt className="text-slate-500">Tipo</dt><dd>{invitation.conditionType === 'CUSTOM' ? 'Personalizada' : 'Padrão'}</dd></div>
      <div><dt className="text-slate-500">Faixa / alunos</dt><dd>{invitation.planCode ?? invitation.studentCount}</dd></div>
      <div><dt className="text-slate-500">Mensalidade estimada</dt><dd>{invitation.monthlyAmountCents == null ? 'Conforme faixa no onboarding' : (invitation.monthlyAmountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</dd></div>
      {invitation.conditionType === 'CUSTOM' ? <>
        <div><dt className="text-slate-500">Valor base mensal</dt><dd>{((invitation.customBaseMonthlyAmountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</dd></div>
        <div><dt className="text-slate-500">Alunos incluídos</dt><dd>{invitation.customIncludedStudentCount ?? '—'}</dd></div>
        <div><dt className="text-slate-500">Mensalidade por aluno excedente</dt><dd>{((invitation.customMonthlyOverageAmountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</dd></div>
      </> : null}
      <div><dt className="text-slate-500">Trial</dt><dd>{invitation.trialDays} dias</dd></div>
      <div><dt className="text-slate-500">Aceito em</dt><dd>{invitation.acceptedAt?.toLocaleString('pt-BR') ?? 'Ainda não aceito'}</dd></div>
      <div><dt className="text-slate-500">Conta criada</dt><dd>{invitation.acceptedContaId ?? '—'}</dd></div>
    </dl><h3 className="mt-5 font-semibold">Versões imutáveis do acordo</h3><ol className="mt-2 grid gap-2 text-sm">{invitation.conditionVersions.map((version) => <li key={version.id} className="rounded-md bg-slate-50 p-3">Versão {version.version} · {version.createdAt.toLocaleString('pt-BR')} · {version.createdBy}<pre className="mt-1 whitespace-pre-wrap text-xs">{JSON.stringify(version.snapshot, null, 2)}</pre></li>)}</ol></section>
    <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 text-lg font-semibold">Histórico</h2><ol className="grid gap-3">{invitation.history.map((entry) => <li key={entry.id} className="border-l-2 border-violet-200 pl-3 text-sm"><strong>{entry.action}</strong><span className="ml-2 text-slate-500">{entry.createdAt.toLocaleString('pt-BR')} · {entry.actorId}</span><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(entry.after, null, 2)}</pre></li>)}{invitation.history.length === 0 ? <li className="text-sm text-slate-500">Sem alterações.</li> : null}</ol></section>
    {canEditCondition ? <><InvitationEditor invitation={invitation} />{invitation.status === 'PENDING' ? <section className="rounded-xl border bg-white p-5"><h2 className="mb-3 text-lg font-semibold">Entrega do convite</h2><p className="mb-3 text-sm text-slate-600">Status do e-mail: {invitation.emailDeliveryStatus}{invitation.emailDeliveryErrorCode ? ` (${invitation.emailDeliveryErrorCode})` : ''}</p><InvitationResender invitationId={invitation.id} /></section> : null}</> : <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">O billing já foi iniciado. Alterações de assinatura usam o fluxo próprio de plan change, com registro de proration e aceite da escola.</p>}
  </main></SupportShell>;
}
