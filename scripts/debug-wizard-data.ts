import { prisma } from '@alusa/database';

async function main() {
  const fp = await prisma.financeProfile.findFirst({
    where: { wizardStep: 5 },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      contaId: true,
      draftPersonType: true,
      draftCpfCnpj: true,
      draftBirthDate: true,
      asaasOwnerName: true,
      mobilePhone: true,
      address: true,
      addressNumber: true,
      province: true,
      postalCode: true,
      incomeValue: true,
    }
  });
  console.log('FinanceProfile:', JSON.stringify(fp, null, 2));

  if (fp) {
    const conta = await prisma.conta.findUnique({
      where: { id: fp.contaId },
      select: { id: true, ownerUserId: true, cpfCnpj: true }
    });
    console.log('Conta:', JSON.stringify(conta, null, 2));

    if (conta?.ownerUserId) {
      const user = await prisma.usuario.findUnique({
        where: { id: conta.ownerUserId },
        select: { id: true, email: true, birthDate: true }
      });
      console.log('Usuario (owner):', JSON.stringify(user, null, 2));
    } else {
      const firstUser = await prisma.usuario.findFirst({
        where: { contaId: fp.contaId },
        select: { id: true, email: true, birthDate: true },
        orderBy: { createdAt: 'asc' }
      });
      console.log('Usuario (first):', JSON.stringify(firstUser, null, 2));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
