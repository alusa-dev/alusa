import { prisma } from '@alusa/lib';

(async () => {
  const data = await prisma.professor.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      nome: true,
      contaId: true,
      cpf: true,
      email: true,
      createdAt: true,
    },
  });
  console.log(JSON.stringify(data, null, 2));
  await prisma.$disconnect();
})();
