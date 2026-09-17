import { prisma } from '@/lib/prisma';

export async function ensureDevelopmentHealthFixture() {
  let conta = await prisma.conta.upsert({
    where: { id: 'conta-default' },
    update: {},
    create: {
      id: 'conta-default',
      nome: 'Alusa Demo',
      cpfCnpj: '00000000000191',
      status: 'ATIVO',
    },
  });
  const owner = await prisma.usuario.upsert({
    where: { email: 'owner+health@example.com' },
    update: { contaId: conta.id },
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
  if (conta.ownerUserId !== owner.id) {
    conta = await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: owner.id } });
  }
  return { id: conta.id, nome: conta.nome };
}

export async function checkDatabaseConnectivity() {
  await prisma.$queryRaw`SELECT 1`;
}
