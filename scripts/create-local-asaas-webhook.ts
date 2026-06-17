/**
 * Cria webhook Asaas para dev local (ngrok) conforme buildExpectedWebhookConfig.
 * Uso: pnpm exec dotenv -e .env.local -- tsx scripts/create-local-asaas-webhook.ts
 */
import { createHmac, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { decryptSecret } from '../packages/lib/src/security/encryption.js';
import { PROVISIONED_WEBHOOK_EVENTS } from '../packages/finance/src/webhooks/webhook-provisioning-events';

const prisma = new PrismaClient();

const RECOMMENDED_WEBHOOK_NAME = 'Alusa - Webhook financeiro';
const RECOMMENDED_WEBHOOK_SEND_TYPE = 'SEQUENTIALLY' as const;

function hashWebhookAuthToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function deriveWebhookAuthToken(financeProfileId: string) {
  const secret = process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET?.trim();
  if (!secret) throw new Error('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET ausente');
  return createHmac('sha256', secret).update(`financeProfile:${financeProfileId}`).digest('base64url');
}

function resolveWebhookUrl() {
  const base = process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL?.trim();
  if (!base) throw new Error('ASAAS_WEBHOOK_PUBLIC_BASE_URL ausente');
  return `${base.replace(/\/$/, '')}/api/webhooks/asaas`;
}

async function resolveEmail(financeProfileId: string, contaId: string) {
  const account = await prisma.asaasAccount.findUnique({
    where: { financeProfileId },
    select: { asaasAccountEmail: true },
  });
  if (account?.asaasAccountEmail?.trim()) return account.asaasAccountEmail.trim();

  const profile = await prisma.financeProfile.findUnique({
    where: { id: financeProfileId },
    select: { asaasLoginEmail: true },
  });
  if (profile?.asaasLoginEmail?.trim()) return profile.asaasLoginEmail.trim();

  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: { ownerUserId: true },
  });
  if (conta?.ownerUserId) {
    const owner = await prisma.usuario.findUnique({
      where: { id: conta.ownerUserId },
      select: { email: true },
    });
    if (owner?.email?.trim()) return owner.email.trim();
  }

  return 'gestao.alusa@gmail.com';
}

async function main() {
  const account = await prisma.asaasAccount.findFirst({
    where: { asaasAccountId: { not: null }, apiKeyStatus: 'CONNECTED' },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      financeProfileId: true,
      asaasAccountId: true,
      apiKeyEncrypted: true,
      webhookAuthTokenHash: true,
      financeProfile: { select: { contaId: true, conta: { select: { nome: true } } } },
    },
  });

  if (!account?.asaasAccountId) throw new Error('Nenhuma subconta CONNECTED encontrada');

  const apiKey = decryptSecret(account.apiKeyEncrypted);
  if (!apiKey) throw new Error('Falha ao descriptografar API key da subconta');

  const webhookUrl = resolveWebhookUrl();
  const authToken = deriveWebhookAuthToken(account.financeProfileId);
  const email = await resolveEmail(account.financeProfileId, account.financeProfile.contaId);

  const payload = {
    name: RECOMMENDED_WEBHOOK_NAME,
    url: webhookUrl,
    email,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken,
    sendType: RECOMMENDED_WEBHOOK_SEND_TYPE,
    events: [...PROVISIONED_WEBHOOK_EVENTS],
  };

  const baseUrl = (process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com/v3').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/webhooks`, {
    method: 'POST',
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`Asaas POST /webhooks falhou (${response.status}): ${JSON.stringify(body)}`);
  }

  const authTokenHash = hashWebhookAuthToken(authToken);
  await prisma.asaasAccount.update({
    where: { financeProfileId: account.financeProfileId },
    data: { webhookAuthTokenHash: authTokenHash },
  });

  console.log(
    JSON.stringify(
      {
        created: true,
        conta: account.financeProfile.conta.nome,
        contaId: account.financeProfile.contaId,
        asaasAccountId: account.asaasAccountId,
        webhookId: body.id,
        webhookUrl: body.url,
        enabled: body.enabled,
        interrupted: body.interrupted,
        eventsCount: Array.isArray(body.events) ? body.events.length : payload.events.length,
        email,
        apiKey: `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
