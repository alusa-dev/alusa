import { prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { updateAsaasAccount } from './update-asaas-account';
import { needsSubaccountEmailSync, resolveCanonicalSubaccountEmail } from './subaccount-email';

export async function ensureSubaccountEmailSynced(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}): Promise<{ synced: boolean; canonicalEmail: string | null }> {
  const [financeProfile, conta] = await Promise.all([
    prisma.financeProfile.findUnique({
      where: { contaId: params.contaId },
      select: {
        id: true,
        asaasAccount: {
          select: {
            asaasAccountId: true,
            asaasAccountEmail: true,
          },
        },
      },
    }),
    prisma.conta.findUnique({
      where: { id: params.contaId },
      select: { ownerUserId: true },
    }),
  ]);

  if (!financeProfile?.asaasAccount?.asaasAccountId) {
    return { synced: false, canonicalEmail: null };
  }

  const ownerUser = conta?.ownerUserId
    ? await prisma.usuario.findUnique({ where: { id: conta.ownerUserId }, select: { email: true } })
    : await prisma.usuario.findFirst({
        where: { contaId: params.contaId },
        select: { email: true },
        orderBy: { createdAt: 'asc' },
      });

  const canonicalEmail = resolveCanonicalSubaccountEmail(ownerUser?.email ?? null);
  if (!canonicalEmail) {
    return { synced: false, canonicalEmail: null };
  }

  if (!needsSubaccountEmailSync(financeProfile.asaasAccount.asaasAccountEmail, canonicalEmail)) {
    return { synced: false, canonicalEmail };
  }

  await updateAsaasAccount({
    contaId: params.contaId,
    data: {},
    actor: params.actor ?? { type: 'SYSTEM' },
  });

  return { synced: true, canonicalEmail };
}
