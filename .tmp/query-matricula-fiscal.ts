import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const matriculaId = 'cmqjmrej400865zyjkeqxox1l';
const contaId = 'b993d42e-0a2a-49c7-878e-5c650ad8cab0';

async function main() {
  const cobrancas = await prisma.cobranca.findMany({
    where: { matriculaId, contaId },
    select: {
      id: true,
      status: true,
      valor: true,
      valorFinal: true,
      descricao: true,
      asaasPaymentId: true,
      asaasStatus: true,
      competenciaInicio: true,
      competenciaFim: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log('ALL_COBRANCAS', JSON.stringify(cobrancas, (_k, v) => v instanceof Date ? v.toISOString() : v, 2));

  for (const c of cobrancas) {
    const charge = await prisma.charge.findFirst({ where: { cobrancaId: c.id } });
    const invoice = charge
      ? await prisma.invoice.findFirst({ where: { chargeId: charge.id } })
      : null;
    console.log('PAIR', {
      cobrancaId: c.id,
      chargeId: charge?.id,
      chargeStatus: charge?.status,
      invoiceStatus: invoice?.status,
      asaasInvoiceId: invoice?.asaasInvoiceId,
    });
  }

  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: {
      asaasAccount: {
        select: {
          asaasAccountId: true,
          asaasAccountEmail: true,
          apiKeyEncrypted: true,
          apiKeyStatus: true,
        },
      },
    },
  });
  console.log('ASAAS', {
    accountId: profile?.asaasAccount?.asaasAccountId,
    email: profile?.asaasAccount?.asaasAccountEmail,
    apiKeyStatus: profile?.asaasAccount?.apiKeyStatus,
    hasKey: Boolean(profile?.asaasAccount?.apiKeyEncrypted),
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
