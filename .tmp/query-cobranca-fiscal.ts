import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cobrancaId = 'cmqjmrejo008a5zyj07hcx205';
  const cobranca = await prisma.cobranca.findFirst({
    where: { id: cobrancaId },
    select: {
      id: true,
      contaId: true,
      status: true,
      matriculaId: true,
      asaasPaymentId: true,
      asaasStatus: true,
      valor: true,
      valorFinal: true,
      descricao: true,
    },
  });
  console.log('COBRANCA', JSON.stringify(cobranca, null, 2));
  if (!cobranca) return;

  const charge = await prisma.charge.findFirst({
    where: { cobrancaId },
    select: { id: true, status: true, asaasPaymentId: true, asaasStatus: true, value: true },
  });
  console.log('CHARGE', JSON.stringify(charge, null, 2));

  const invoice = charge
    ? await prisma.invoice.findFirst({ where: { chargeId: charge.id } })
    : null;
  console.log(
    'INVOICE',
    JSON.stringify(
      invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            asaasInvoiceId: invoice.asaasInvoiceId,
            errorMessage: invoice.errorMessage,
            scheduledAt: invoice.scheduledAt?.toISOString(),
          }
        : null,
      null,
      2,
    ),
  );

  const fiscal = await prisma.contaFiscalSettings.findUnique({
    where: { contaId: cobranca.contaId },
  });
  console.log(
    'FISCAL',
    JSON.stringify(
      fiscal
        ? {
            emissionMode: fiscal.emissionMode,
            readinessStatus: fiscal.readinessStatus,
            invoiceReceivedOnly: fiscal.invoiceReceivedOnly,
            invoiceEffectiveDatePeriod: fiscal.invoiceEffectiveDatePeriod,
            syncStatus: fiscal.syncStatus,
          }
        : null,
      null,
      2,
    ),
  );

  const profile = await prisma.financeProfile.findUnique({
    where: { contaId: cobranca.contaId },
    select: {
      asaasAccountId: true,
      asaasAccount: {
        select: {
          asaasAccountId: true,
          asaasAccountEmail: true,
          apiKeyStatus: true,
          status: true,
        },
      },
    },
  });
  console.log('FINANCE_PROFILE', JSON.stringify(profile, null, 2));

  if (cobranca.matriculaId) {
    const sub = await prisma.subscription.findFirst({
      where: { matriculaId: cobranca.matriculaId, contaId: cobranca.contaId },
      select: {
        id: true,
        asaasSubscriptionId: true,
        asaasInvoiceSettingsConfigured: true,
        fiscalInvoiceSettingsSyncedAt: true,
        fiscalInvoiceSettingsError: true,
      },
    });
    console.log('SUBSCRIPTION', JSON.stringify(sub, null, 2));
  }

  const audits = await prisma.auditLog.findMany({
    where: {
      contaId: cobranca.contaId,
      OR: [
        {
          action: {
            in: [
              'finance.invoice.auto_emit_failed',
              'finance.invoice.scheduled',
              'finance.subscription.invoice_settings.upserted',
              'finance.subscription.invoice_settings.deleted',
            ],
          },
        },
        {
          entity: charge ? { type: 'Charge', id: charge.id } : undefined,
        },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { action: true, createdAt: true, metadata: true, entityType: true, entityId: true },
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
