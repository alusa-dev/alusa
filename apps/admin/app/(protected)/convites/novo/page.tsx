import { notFound } from 'next/navigation';
import { requireAdminSessionForPage } from '@/lib/admin-session';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { InvitationCreator } from '@/features/school-invitations/InvitationCreator';
import { hasSupportRoleAccess } from '@/features/support/auth/permissions';

export default async function NewCommercialInvitationPage() {
  const session = await requireAdminSessionForPage('/convites/novo');
  if (!hasSupportRoleAccess(session, ['SUPPORT_ADMIN', 'SUPPORT_FINANCE'], 'admin-school-invitations')) notFound();
  return <SupportShell session={session}><main className="mx-auto grid max-w-5xl gap-6 px-6 py-8">
    <header><h1 className="text-2xl font-semibold">Convidar escolas</h1><p className="mt-1 text-sm text-slate-600">Defina a condição comercial e envie o convite para a nova escola.</p></header>
    <InvitationCreator />
  </main></SupportShell>;
}
