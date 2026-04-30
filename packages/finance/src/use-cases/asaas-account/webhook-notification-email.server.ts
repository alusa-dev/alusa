import { prisma } from '@alusa/database';

export async function resolveWebhookNotificationEmail(params: {
  contaId: string;
  financeProfileId: string;
}): Promise<string | null> {
  const account = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: params.financeProfileId },
    select: { asaasAccountEmail: true },
  });
  const accountEmail = account?.asaasAccountEmail?.trim();
  if (accountEmail) return accountEmail;

  const profile = await prisma.financeProfile.findUnique({
    where: { id: params.financeProfileId },
    select: { asaasLoginEmail: true },
  });
  const loginEmail = profile?.asaasLoginEmail?.trim();
  if (loginEmail) return loginEmail;

  const conta = await prisma.conta.findUnique({
    where: { id: params.contaId },
    select: { ownerUserId: true },
  });

  if (conta?.ownerUserId) {
    const ownerUser = await prisma.usuario.findUnique({
      where: { id: conta.ownerUserId },
      select: { email: true },
    });
    const ownerEmail = ownerUser?.email?.trim();
    if (ownerEmail) return ownerEmail;
  }

  const fallbackUser = await prisma.usuario.findFirst({
    where: { contaId: params.contaId },
    orderBy: { createdAt: 'asc' },
    select: { email: true },
  });

  return fallbackUser?.email?.trim() || null;
}
