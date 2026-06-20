import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'gestao.alusa+wl01@gmail.com';
  const user = await prisma.usuario.findFirst({
    where: { email },
    select: { id: true, email: true, role: true },
  });
  console.log('USER', JSON.stringify(user, null, 2));
  if (!user) return;

  const userConta = await prisma.usuarioConta.findFirst({
    where: { usuarioId: user.id },
    select: { contaId: true },
  });
  const contaId = userConta?.contaId;
  if (!contaId) {
    console.log('NO_CONTA');
    return;
  }

  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: { id: true, nome: true, cpfCnpj: true, status: true },
  });
  console.log('CONTA', JSON.stringify(conta, null, 2));

  const fiscal = await prisma.contaFiscalSettings.findUnique({ where: { contaId } });
  console.log(
    'FISCAL',
    JSON.stringify(
      fiscal,
      (_k, v) => (v instanceof Date ? v.toISOString() : v),
      2,
    ),
  );

  const defaultService = await prisma.fiscalService.findFirst({
    where: { contaId: contaId, isDefault: true },
  });
  console.log(
    'DEFAULT_SERVICE',
    JSON.stringify(
      defaultService,
      (_k, v) => (v instanceof Date ? v.toISOString() : v),
      2,
    ),
  );

  const cobrancaId = 'cmqjmrejo008a5zyj07hcx205';
  const cobranca = await prisma.cobranca.findFirst({
    where: { id: cobrancaId, contaId },
    select: {
      id: true,
      status: true,
      valor: true,
      valorFinal: true,
      matriculaId: true,
      asaasPaymentId: true,
      asaasStatus: true,
      tipo: true,
      descricao: true,
    },
  });
  console.log('COBRANCA', JSON.stringify(cobranca, null, 2));

  const charge = await prisma.charge.findFirst({
    where: { cobrancaId, contaId },
    select: { id: true, status: true, asaasPaymentId: true, asaasStatus: true, value: true },
  });
  console.log('CHARGE', JSON.stringify(charge, null, 2));

  const invoice = charge
    ? await prisma.invoice.findFirst({ where: { chargeId: charge.id, contaId } })
    : null;
  console.log(
    'INVOICE',
    JSON.stringify(
      invoice,
      (_k, v) => (v instanceof Date ? v.toISOString() : v),
      2,
    ),
  );

  if (cobranca?.matriculaId) {
    const sub = await prisma.subscription.findFirst({
      where: { matriculaId: cobranca.matriculaId, contaId },
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

  const asaasAccount = await prisma.asaasAccount.findFirst({
    where: { contaId },
    select: { id: true, asaasAccountId: true, walletId: true, status: true },
  });
  console.log('ASAAS_ACCOUNT', JSON.stringify(asaasAccount, null, 2));

  const audits = await prisma.auditLog.findMany({
    where: {
      contaId,
      action: {
        in: [
          'finance.invoice.auto_emit_failed',
          'finance.invoice.scheduled',
          'finance.subscription.invoice_settings.upserted',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { action: true, createdAt: true, metadata: true },
  });
  console.log(
    'RECENT_AUDITS',
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
