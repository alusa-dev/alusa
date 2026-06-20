import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const contaId = 'b993d42e-0a2a-49c7-878e-5c650ad8cab0';

async function main() {
  const cobrancas = await prisma.cobranca.findMany({
    where: {
      contaId,
      OR: [
        { descricao: { contains: 'Bryan', mode: 'insensitive' } },
        { id: { startsWith: 'cmqjm' } },
      ],
    },
    select: {
      id: true,
      status: true,
      asaasPaymentId: true,
      asaasStatus: true,
      matriculaId: true,
      descricao: true,
      valorFinal: true,
    },
    take: 10,
  });
  console.log('COBRANCAS', JSON.stringify(cobrancas, null, 2));

  const subs = await prisma.subscription.findMany({
    where: { contaId },
    select: {
      id: true,
      matriculaId: true,
      asaasSubscriptionId: true,
      asaasInvoiceSettingsConfigured: true,
      fiscalInvoiceSettingsSyncedAt: true,
      fiscalInvoiceSettingsError: true,
    },
  });
  console.log('SUBSCRIPTIONS', JSON.stringify(subs, null, 2));

  const invoices = await prisma.invoice.findMany({
    where: { contaId },
    select: {
      id: true,
      chargeId: true,
      status: true,
      asaasInvoiceId: true,
      cobrancaId: true,
      errorMessage: true,
    },
    take: 10,
  });
  console.log('INVOICES', JSON.stringify(invoices, null, 2));

  const audits = await prisma.auditLog.findMany({
    where: {
      contaId,
      action: {
        in: [
          'finance.invoice.auto_emit_failed',
          'finance.subscription.invoice_settings.upserted',
          'finance.subscription.invoice_settings.deleted',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { action: true, createdAt: true, metadata: true },
  });
  console.log(
    'AUDITS',
    JSON.stringify(
      audits,
      (_k, v) => (v instanceof Date ? v.toISOString() : v),
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
