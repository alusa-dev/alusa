import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@alusa/database';
import { requireAdminSessionForPage } from '@/lib/admin-session';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { hasSupportRoleAccess } from '@/features/support/auth/permissions';

export default async function CommercialInvitationsPage() {
  const session = await requireAdminSessionForPage('/convites');
  if (!hasSupportRoleAccess(session, ['SUPPORT_ADMIN', 'SUPPORT_FINANCE'], 'admin-school-invitations')) notFound();
  const invitations = await prisma.platformSchoolInvitation.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, schoolName: true, email: true, conditionType: true, planCode: true, monthlyAmountCents: true, studentCount: true, trialDays: true, expiresAt: true, status: true, createdAt: true },
  });
  return <SupportShell session={session}><main className="mx-auto grid max-w-6xl gap-8 px-6 py-8">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold">Gestão de convites</h1><p className="mt-1 text-sm text-slate-600">Acompanhe convites comerciais enviados às escolas.</p></div><Link href="/convites/novo" className="rounded-md bg-violet-800 px-4 py-2 text-sm font-semibold text-white">Convidar escolas</Link></header>
    <section className="overflow-hidden rounded-xl border bg-white">
      <h2 className="border-b px-5 py-4 text-lg font-semibold">Convites recentes</h2>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{['Escola', 'E-mail', 'Condição', 'Alunos', 'Teste', 'Expira', 'Status', ''].map((name) => <th key={name} className="px-4 py-3 font-medium">{name}</th>)}</tr></thead>
        <tbody>{invitations.map((invitation) => <tr key={invitation.id} className="border-t"><td className="px-4 py-3 font-medium">{invitation.schoolName}</td><td className="px-4 py-3">{invitation.email}</td><td className="px-4 py-3">{invitation.conditionType === 'CUSTOM' ? `Personalizada · ${((invitation.monthlyAmountCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : invitation.planCode?.replaceAll('_', ' ')}</td><td className="px-4 py-3">{invitation.studentCount}</td><td className="px-4 py-3">{invitation.trialDays} dias</td><td className="px-4 py-3">{invitation.expiresAt.toLocaleDateString('pt-BR')}</td><td className="px-4 py-3">{invitation.status === 'PENDING' && invitation.expiresAt <= new Date() ? 'Expirado' : invitation.status}</td><td className="px-4 py-3"><Link className="text-violet-800 underline" href={`/convites/${invitation.id}`}>Detalhes</Link></td></tr>)}
        {invitations.length === 0 ? <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Nenhum convite criado.</td></tr> : null}</tbody>
      </table></div>
    </section>
  </main></SupportShell>;
}
