import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Reconcilia cobranças que ficaram com asaasStatus = 'RECEIVED_IN_CASH'
 * mas status local != 'PAGO' devido ao bug de PAYMENT_STATUSES.RECEIVED_IN_CASH = undefined.
 */
async function main() {
  const affected = await prisma.cobranca.findMany({
    where: {
      asaasStatus: 'RECEIVED_IN_CASH',
      status: { notIn: ['PAGO', 'CANCELADO', 'ESTORNADO'] },
    },
    select: {
      id: true,
      status: true,
      asaasStatus: true,
      valor: true,
      liquidadoEm: true,
      dataPagamento: true,
      pagoEm: true,
      asaasPaymentId: true,
      descricao: true,
    },
  });

  if (affected.length === 0) {
    console.log('✅ Nenhuma cobrança inconsistente encontrada.');
    return;
  }

  console.log(`🔍 Encontradas ${affected.length} cobrança(s) inconsistente(s):\n`);

  for (const c of affected) {
    console.log(`  - ${c.id} | ${c.status} | R$${c.valor} | ${c.descricao} | paymentId: ${c.asaasPaymentId}`);
  }

  console.log('\n🔧 Reconciliando...\n');

  let reconciled = 0;

  for (const c of affected) {
    const paymentDate = c.liquidadoEm ?? new Date();

    await prisma.cobranca.update({
      where: { id: c.id },
      data: {
        status: 'PAGO',
        dataPagamento: paymentDate,
        pagoEm: paymentDate,
        updatedAt: new Date(),
      },
    });

    console.log(`  ✅ ${c.id} → PAGO (dataPagamento: ${paymentDate.toISOString()})`);
    reconciled++;
  }

  console.log(`\n✅ Reconciliação concluída: ${reconciled}/${affected.length} cobrança(s) corrigidas.`);
}

main()
  .catch((e) => {
    console.error('❌ Erro na reconciliação:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
