import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const asaasPaymentId = 'pay_1yus9kzzsgdb01nd'; // ID confirmado no Asaas

  const cobranca = await prisma.cobranca.findFirst({
    where: { asaasPaymentId },
  });

  if (!cobranca) {
    console.log('Cobrança não encontrada para asaasPaymentId:', asaasPaymentId);
    process.exit(1);
  }

  if (cobranca.status === 'PAGO') {
    console.log('Cobrança já está marcada como PAGO localmente.');
    process.exit(0);
  }

  await prisma.cobranca.update({
    where: { id: cobranca.id },
    data: {
      status: 'PAGO',
      updatedAt: new Date(),
    },
  });

  console.log('Cobrança reconciliada e atualizada para PAGO:', cobranca.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
