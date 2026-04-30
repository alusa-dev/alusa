import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const chargeId = 'cmkq10tgn000vgr9klhyr814l';
  
  console.log(`Reverting charge ${chargeId} to PENDENTE...`);
  
  const updated = await prisma.cobranca.update({
    where: { id: chargeId },
    data: {
      status: 'PENDENTE',
      liquidacaoStatus: 'NAO_APLICAVEL', // Assuming PENDENTE status implies no liquidation yet
      pagoEm: null,
      liquidadoEm: null,
      asaasStatus: 'PENDING' // Mirroring Asaas
    }
  });

  console.log('Charge reverted:', updated);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
