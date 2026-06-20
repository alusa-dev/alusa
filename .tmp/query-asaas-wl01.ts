import { PrismaClient } from '@prisma/client';
import { decryptSecret } from '../packages/database/src/security/encryption.ts';

const prisma = new PrismaClient();
const contaId = 'b993d42e-0a2a-49c7-878e-5c650ad8cab0';

async function asaasGet(apiKey: string, path: string) {
  const res = await fetch(`https://api-sandbox.asaas.com${path}`, {
    headers: { access_token: apiKey },
  });
  return { status: res.status, body: await res.text() };
}

async function main() {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: { asaasAccount: { select: { apiKeyEncrypted: true, apiKeyStatus: true } } },
  });
  const apiKey = decryptSecret(profile?.asaasAccount?.apiKeyEncrypted ?? null);
  if (!apiKey) {
    console.log('NO_API_KEY');
    return;
  }

  const subId = 'sub_yp0otq2wqcos030b';
  const payEnrollment = 'pay_7rynaous2aog0aji';
  const payMensalidade = 'pay_4s3umbmmgmw8s510';

  for (const [label, path] of [
    ['SUB_INVOICE_SETTINGS', `/v3/subscriptions/${subId}/invoiceSettings`],
    ['PAY_ENROLLMENT', `/v3/payments/${payEnrollment}`],
    ['PAY_MENSALIDADE', `/v3/payments/${payMensalidade}`],
    ['INVOICES_ENROLLMENT', `/v3/invoices?payment=${payEnrollment}&limit=5`],
    ['INVOICES_MENSALIDADE', `/v3/invoices?payment=${payMensalidade}&limit=5`],
  ] as const) {
    const r = await asaasGet(apiKey, path);
    console.log(label, r.status);
    console.log(r.body);
    console.log('---');
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
