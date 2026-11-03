import { prisma } from '@/lib/prisma';

export async function ensureDevelopmentHealthFixture() {
  return prisma.$transaction(async (tx) => {
    const conta = await tx.conta.upsert({
      where: { id: 'conta-default' },
      update: {},
      create: {
        id: 'conta-default',
        nome: 'Alusa Demo',
        cpfCnpj: '00000000000191',
        status: 'ATIVO',
      },
    });
    const owner = await tx.usuario.upsert({
      where: { email: 'owner+health@example.com' },
      update: { contaId: conta.id, role: 'ADMIN', status: 'ATIVO' },
      create: {
        id: 'owner-health',
        contaId: conta.id,
        nome: 'Owner Health',
        email: 'owner+health@example.com',
        senhaHash: 'x',
        role: 'ADMIN',
        status: 'ATIVO',
      },
    });
    await tx.conta.update({ where: { id: conta.id }, data: { ownerUserId: owner.id } });
    await tx.usuarioConta.upsert({
      where: { usuarioId_contaId: { usuarioId: owner.id, contaId: conta.id } },
      update: { role: owner.role, status: owner.status },
      create: { usuarioId: owner.id, contaId: conta.id, role: owner.role, status: owner.status },
    });
    return { id: conta.id, nome: conta.nome };
  });
}

export async function checkDatabaseConnectivity() {
  await prisma.$queryRaw`SELECT 1`;
}
