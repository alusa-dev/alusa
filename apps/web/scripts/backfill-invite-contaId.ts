/*
  Script opcional de backfill para popular Invite.contaId com base no invitedById.
  Execução manual: node -e "require('./scripts/backfill-invite-contaId').run()"
*/
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function run() {
  const invites = await prisma.invite.findMany({ where: { contaId: null }, select: { id: true, invitedById: true } });
  for (const inv of invites) {
    const inviter = await prisma.usuario.findUnique({ where: { id: inv.invitedById } });
    if (inviter?.contaId) {
      await prisma.invite.update({ where: { id: inv.id }, data: { contaId: inviter.contaId } });
      // eslint-disable-next-line no-console
      console.log('Updated invite', inv.id);
    }
  }
  await prisma.$disconnect();
}

if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
