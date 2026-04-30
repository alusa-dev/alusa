/**
 * Reconcilia onboarding financeiro de uma conta específica com a subconta Asaas existente.
 *
 * Uso:
 *   dotenv -e apps/web/.env.local -- pnpm tsx scripts/reconcile-finance-onboarding.ts
 *
 * O script:
 * 1. Localiza a subconta remota no Asaas pelo CPF do FinanceProfile
 * 2. Cria um AccessToken na subconta
 * 3. Criptografa e persiste a API key localmente
 * 4. Cria o webhook na subconta se não existir
 * 5. Atualiza AsaasAccount, AsaasCredential e FinanceProfile no banco
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const CONTA_ID = '446982cc-6333-4248-99fc-50d51219ee4f';
const FINANCE_PROFILE_ID = 'cmokejl6i0035d5oc30nyyzmk';

const ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';
const ASAAS_MASTER_KEY = process.env.ASAAS_API_KEY;
const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY ?? '';
const WEBHOOK_TOKEN_SECRET = process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET ?? '';
const WEBHOOK_PUBLIC_BASE_URL = process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL ?? '';

const WEBHOOK_NAME = 'Alusa - Webhook Principal';
const WEBHOOK_SEND_TYPE = 'NON_SEQUENTIALLY';
const WEBHOOK_EVENTS = [
  'PAYMENT_CREATED',
  'PAYMENT_AWAITING_RISK_ANALYSIS',
  'PAYMENT_APPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_AUTHORIZED',
  'PAYMENT_UPDATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_ANTICIPATED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_RESTORED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  'PAYMENT_DUNNING_RECEIVED',
  'PAYMENT_DUNNING_REQUESTED',
  'PAYMENT_BANK_SLIP_VIEWED',
  'PAYMENT_CHECKOUT_VIEWED',
  'PAYMENT_SPLIT_CANCELLED',
  'PAYMENT_SPLIT_REFUNDED',
  'TRANSFER_CREATED',
  'TRANSFER_PENDING',
  'TRANSFER_IN_BANK_PROCESSING',
  'TRANSFER_BLOCKED',
  'TRANSFER_DONE',
  'TRANSFER_FAILED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_DELETED',
  'SUBSCRIPTION_RENEWED',
  'ACCOUNT_STATUS_UPDATED',
  'ACCOUNT_DOCUMENT_APPROVED',
  'ACCOUNT_DOCUMENT_DENIED',
];

const prisma = new PrismaClient();

function getEncryptionKey(): Buffer {
  const raw = ENCRYPTION_KEY_RAW;
  if (!raw) throw new Error('ENCRYPTION_KEY não configurada');
  return /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const salt = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), salt.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

function deriveWebhookAuthToken(financeProfileId: string): string {
  if (!WEBHOOK_TOKEN_SECRET) throw new Error('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET não configurada');
  return crypto.createHmac('sha256', WEBHOOK_TOKEN_SECRET).update(`financeProfile:${financeProfileId}`).digest('base64url');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildWebhookUrl(financeProfileId: string): string {
  if (!WEBHOOK_PUBLIC_BASE_URL) throw new Error('ASAAS_WEBHOOK_PUBLIC_BASE_URL não configurada');
  return `${WEBHOOK_PUBLIC_BASE_URL}/api/webhooks/asaas/${financeProfileId}`;
}

async function asaasGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function asaasPost<T>(path: string, apiKey: string, body: unknown): Promise<T> {
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    method: 'POST',
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${bodyText}`);
  }
  return res.json() as Promise<T>;
}

async function main() {
  if (!ASAAS_MASTER_KEY) throw new Error('ASAAS_API_KEY não configurada');
  if (!WEBHOOK_TOKEN_SECRET) throw new Error('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET não configurada');

  console.log(`\n== Reconciliação de onboarding financeiro ==`);
  console.log(`contaId: ${CONTA_ID}`);
  console.log(`financeProfileId: ${FINANCE_PROFILE_ID}`);
  console.log(`Asaas base URL: ${ASAAS_BASE_URL}\n`);

  // 1. Ler financeProfile do banco
  const profile = await prisma.financeProfile.findUniqueOrThrow({
    where: { id: FINANCE_PROFILE_ID },
    select: { id: true, contaId: true, draftCpfCnpj: true, asaasLoginEmail: true, asaasName: true },
  });
  console.log(`FinanceProfile encontrado: CPF=${profile.draftCpfCnpj}, email=${profile.asaasLoginEmail}`);

  if (!profile.draftCpfCnpj) throw new Error('FinanceProfile sem CPF/CNPJ (draftCpfCnpj)');

  // 2. Verificar se AsaasAccount já existe localmente
  const existingAccount = await prisma.asaasAccount.findUnique({ where: { financeProfileId: FINANCE_PROFILE_ID } });
  if (existingAccount?.asaasAccountId) {
    console.log(`⚠️  AsaasAccount já existe com asaasAccountId=${existingAccount.asaasAccountId}, status=${existingAccount.status}`);
    console.log('Abortando — use outro script para reconciliar conta já provisionada.');
    process.exit(0);
  }
  console.log(`AsaasAccount local: ${existingAccount ? `id=${existingAccount.id}, sem asaasAccountId` : 'não existe'}\n`);

  // 3. Buscar subconta remota por CPF no Asaas (leitura antes de escrita)
  const cpf = profile.draftCpfCnpj.replace(/\D/g, '');
  console.log(`Buscando subconta no Asaas por CPF ${cpf}...`);
  const subaccountList = await asaasGet<{ data: Array<{ id: string; email: string; cpfCnpj: string; walletId?: string }> }>(
    `/accounts?cpfCnpj=${cpf}`,
    ASAAS_MASTER_KEY,
  );

  if (!subaccountList.data.length) {
    throw new Error(`Nenhuma subconta encontrada no Asaas para CPF ${cpf}`);
  }

  // Preferir subconta com email correspondente, senão pegar a primeira
  const remote =
    subaccountList.data.find((a) => a.email?.toLowerCase() === profile.asaasLoginEmail?.toLowerCase()) ??
    subaccountList.data[0];

  console.log(`Subconta remota encontrada: id=${remote.id}, email=${remote.email}\n`);

  // 4. Criar AccessToken na subconta ou usar chave fornecida manualmente
  // O endpoint POST /accounts/{id}/accessTokens exige:
  //   1. Whitelist de IPs configurada no Asaas
  //   2. Acesso habilitado em Asaas > Integrações > Chaves de API > "Habilitar acesso" (2h)
  // Alternativa: fornecer ASAAS_SUBACCOUNT_API_KEY diretamente (login manual na subconta sandbox)

  let subaccountApiKey: string;
  let accessTokenId = 'manual';

  const manualApiKey = process.env.ASAAS_SUBACCOUNT_API_KEY;
  if (manualApiKey) {
    console.log(`Usando API key fornecida manualmente (ASAAS_SUBACCOUNT_API_KEY)\n`);
    subaccountApiKey = manualApiKey;
  } else {
    console.log(`Criando AccessToken na subconta ${remote.id}...`);
    console.log(`NOTA: requer whitelist de IPs + "Habilitar acesso" habilitado no dashboard Asaas`);
    const accessToken = await asaasPost<{ id: string; name: string; apiKey: string }>(
      `/accounts/${remote.id}/accessTokens`,
      ASAAS_MASTER_KEY,
      { name: `Alusa - API Key (reconcile-${Date.now()})` },
    );
    console.log(`AccessToken criado: id=${accessToken.id}\n`);
    subaccountApiKey = accessToken.apiKey;
    accessTokenId = accessToken.id;
  }

  // 5. Calcular webhookAuthToken e hash  const webhookAuthToken = deriveWebhookAuthToken(FINANCE_PROFILE_ID);
  const webhookAuthTokenHash = hashToken(webhookAuthToken);
  console.log(`webhookAuthTokenHash: ${webhookAuthTokenHash.slice(0, 16)}...`);

  // 6. Criptografar API key
  const encryptedApiKey = encrypt(subaccountApiKey);
  console.log(`API key criptografada\n`);

  // 7. Persistir no banco (upsert AtomicTransaction)
  console.log(`Persistindo no banco...`);
  const now = new Date();
  const externalReference = `financeProfile:${FINANCE_PROFILE_ID}`;

  await prisma.$transaction(async (tx) => {
    await tx.asaasAccount.upsert({
      where: { financeProfileId: FINANCE_PROFILE_ID },
      create: {
        financeProfileId: FINANCE_PROFILE_ID,
        asaasAccountId: remote.id,
        asaasAccountEmail: remote.email,
        externalReference,
        status: 'CREATED',
        statusUpdatedAt: now,
        provisionedAt: now,
        apiKeyEncrypted: encryptedApiKey,
        apiKeyStatus: 'CONNECTED',
        webhookAuthTokenHash,
        provisionLastError: null,
      },
      update: {
        asaasAccountId: remote.id,
        asaasAccountEmail: remote.email,
        status: 'CREATED',
        statusUpdatedAt: now,
        provisionedAt: now,
        apiKeyEncrypted: encryptedApiKey,
        apiKeyStatus: 'CONNECTED',
        webhookAuthTokenHash,
        provisionLastError: null,
      },
    });

    await tx.financeProfile.update({
      where: { id: FINANCE_PROFILE_ID },
      data: { asaasAccountId: remote.id },
      select: { id: true },
    });

    await tx.asaasCredential.upsert({
      where: { financeProfileId: FINANCE_PROFILE_ID },
      create: { financeProfileId: FINANCE_PROFILE_ID, apiKeyEncrypted: encryptedApiKey },
      update: { apiKeyEncrypted: encryptedApiKey },
    });
  });

  console.log(`✅ Banco atualizado\n`);

  // 8. Verificar e criar webhook na subconta
  const webhookUrl = buildWebhookUrl(FINANCE_PROFILE_ID);
  console.log(`Verificando webhook na subconta (URL: ${webhookUrl})...`);

  const webhookList = await asaasGet<{ data: Array<{ id: string; name: string; url: string; enabled: boolean; interrupted: boolean; hasAuthToken: boolean }> }>(
    '/webhooks',
    subaccountApiKey,
  );

  const existingWebhook = webhookList.data.find(
    (w) => w.url.includes(FINANCE_PROFILE_ID) || w.name === WEBHOOK_NAME,
  );

  if (existingWebhook) {
    console.log(`Webhook já existe: id=${existingWebhook.id}, url=${existingWebhook.url}`);
    console.log('Atualizando configuração do webhook...');
    await asaasPost(`/webhooks/${existingWebhook.id}`, subaccountApiKey, {
      name: WEBHOOK_NAME,
      url: webhookUrl,
      enabled: true,
      interrupted: false,
      authToken: webhookAuthToken,
      sendType: WEBHOOK_SEND_TYPE,
      events: WEBHOOK_EVENTS,
    });
    console.log(`✅ Webhook atualizado\n`);
  } else {
    console.log(`Webhook não encontrado. Criando...`);
    const created = await asaasPost<{ id: string }>('/webhooks', subaccountApiKey, {
      name: WEBHOOK_NAME,
      url: webhookUrl,
      enabled: true,
      authToken: webhookAuthToken,
      sendType: WEBHOOK_SEND_TYPE,
      events: WEBHOOK_EVENTS,
    });
    console.log(`✅ Webhook criado: id=${created.id}\n`);
  }

  // 9. Auditoria
  await prisma.auditLog.create({
    data: {
      contaId: CONTA_ID,
      actorType: 'SYSTEM',
      action: 'finance.onboarding.manual_reconciliation',
      entityType: 'AsaasAccount',
      metadata: {
        asaasAccountId: remote.id,
        accessTokenId,
        script: 'reconcile-finance-onboarding',
      },
    },
  });

  console.log(`== Reconciliação concluída com sucesso ==`);
  console.log(`asaasAccountId: ${remote.id}`);
  console.log(`financeProfileId: ${FINANCE_PROFILE_ID}`);
}

main()
  .catch((e) => {
    console.error('❌ Erro na reconciliação:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
