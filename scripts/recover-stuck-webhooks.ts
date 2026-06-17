/**
 * Recupera webhooks travados em PROCESSANDO (reset → ERRO para reprocessamento).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TIMEOUT_MINUTES = 5;

async function main() {
  const threshold = new Date(Date.now() - TIMEOUT_MINUTES * 60_000);

  const stuck = await prisma.webhookAsaas.findMany({
    where: {
      status: 'PROCESSANDO',
      OR: [
        { ultimaTentativaEm: { lt: threshold } },
        { ultimaTentativaEm: null, recebidoEm: { lt: threshold } },
      ],
    },
    select: { id: true, evento: true, recebidoEm: true },
    orderBy: { recebidoEm: 'asc' },
    take: 500,
  });

  if (!stuck.length) {
    console.log('No stuck PROCESSANDO webhooks found.');
    return;
  }

  const result = await prisma.webhookAsaas.updateMany({
    where: { id: { in: stuck.map((row) => row.id) } },
    data: {
      status: 'ERRO',
      ultimoErro: `Recovered from stuck PROCESSANDO (timeout: ${TIMEOUT_MINUTES}min)`,
    },
  });

  console.log(`Recovered ${result.count} webhooks:`, stuck.map((row) => ({
    id: row.id,
    evento: row.evento,
    recebidoEm: row.recebidoEm,
  })));

  const queue = await prisma.webhookAsaas.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  console.log('Queue status counts:', queue);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
