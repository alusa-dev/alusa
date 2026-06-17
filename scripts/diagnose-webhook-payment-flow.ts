/**
 * Diagnóstico: pagamento teste sem atualização local via webhook.
 */
import { createHmac, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { decryptSecret } from '../packages/lib/src/security/encryption.js';
import { inspectWebhookProcessingRuntimeStatus } from '../packages/finance/src/webhooks/webhook-runtime-config';

const prisma = new PrismaClient();

function deriveToken(financeProfileId: string, secret: string) {
  return createHmac('sha256', secret).update(`financeProfile:${financeProfileId}`).digest('base64url');
}

function buildOperationalWarnings(params: {
  webhookBaseUrl: string | null;
  runtime: ReturnType<typeof inspectWebhookProcessingRuntimeStatus>;
  remoteWebhooks: unknown;
}) {
  const warnings: string[] = [];
  const webhookBaseUrl = params.webhookBaseUrl ?? '';

  if (!webhookBaseUrl) {
    warnings.push('ASAAS_WEBHOOK_PUBLIC_BASE_URL não configurada: webhooks reais do Asaas não chegam em localhost.');
  } else if (!webhookBaseUrl.startsWith('https://')) {
    warnings.push('ASAAS_WEBHOOK_PUBLIC_BASE_URL deve ser HTTPS público; o Asaas não segue redirects e pode pausar a fila.');
  } else if (webhookBaseUrl.includes('localhost') || webhookBaseUrl.includes('127.0.0.1')) {
    warnings.push('URL de webhook aponta para localhost; use ngrok/Cloudflare Tunnel para testes reais.');
  }

  if (params.runtime.mode === 'SYNC' && process.env.NODE_ENV !== 'production') {
    warnings.push('Dev em modo SYNC: sem túnel público, dependa do fallback sync-asaas/polling para convergir pagamentos.');
  }

  const interrupted = Array.isArray((params.remoteWebhooks as { data?: unknown[] } | null)?.data)
    ? (params.remoteWebhooks as { data: Array<Record<string, unknown>> }).data.filter((webhook) => webhook.interrupted)
    : [];
  if (interrupted.length > 0) {
    warnings.push(`Há ${interrupted.length} webhook(s) remoto(s) interrompido(s); reative/remova backoff no Asaas após corrigir a URL.`);
  }

  return warnings;
}

async function main() {
  const secret = process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET?.trim();
  const runtime = inspectWebhookProcessingRuntimeStatus();

  const account = await prisma.asaasAccount.findFirst({
    where: { apiKeyStatus: 'CONNECTED', asaasAccountId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      financeProfileId: true,
      asaasAccountId: true,
      webhookAuthTokenHash: true,
      previousWebhookAuthTokenHash: true,
      apiKeyEncrypted: true,
      financeProfile: { select: { contaId: true, conta: { select: { nome: true } } } },
    },
  });

  if (!account) throw new Error('Subconta CONNECTED não encontrada');

  const contaId = account.financeProfile.contaId;
  const expectedToken = secret ? deriveToken(account.financeProfileId, secret) : null;
  const expectedHash = expectedToken ? createHash('sha256').update(expectedToken).digest('hex') : null;

  const apiKey = decryptSecret(account.apiKeyEncrypted);
  const remoteWebhooks = apiKey
    ? await fetch('https://api-sandbox.asaas.com/v3/webhooks?limit=10', {
        headers: { access_token: apiKey },
      }).then((r) => r.json())
    : null;

  const [queue, rejections, recentWebhooks, recentCobrancas, recentCharges] = await Promise.all([
    prisma.webhookAsaas.groupBy({
      by: ['status'],
      where: { contaId },
      _count: { _all: true },
    }),
    prisma.webhookAsaasRejection.findMany({
      where: { contaId },
      orderBy: { recebidoEm: 'desc' },
      take: 10,
      select: { id: true, reason: true, recebidoEm: true, evento: true, eventId: true },
    }),
    prisma.webhookAsaas.findMany({
      where: { contaId },
      orderBy: { recebidoEm: 'desc' },
      take: 15,
      select: {
        id: true,
        evento: true,
        status: true,
        recebidoEm: true,
        processadoEm: true,
        ultimoErro: true,
        tentativas: true,
        asaasPaymentId: true,
      },
    }),
    prisma.cobranca.findMany({
      where: { contaId },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        status: true,
        asaasStatus: true,
        asaasPaymentId: true,
        valor: true,
        updatedAt: true,
        matricula: { select: { aluno: { select: { nome: true } } } },
      },
    }),
    prisma.charge.findMany({
      where: { contaId },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        status: true,
        asaasPaymentId: true,
        value: true,
        updatedAt: true,
      },
    }),
  ]);

  const recentPayments = apiKey
    ? await fetch('https://api-sandbox.asaas.com/v3/payments?limit=10&offset=0', {
        headers: { access_token: apiKey },
      }).then((r) => r.json())
    : null;

  const webhookUrl = `${(process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL || '').replace(/\/$/, '')}/api/webhooks/asaas`;
  const operationalWarnings = buildOperationalWarnings({
    webhookBaseUrl: process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL || null,
    runtime,
    remoteWebhooks,
  });

  console.log(
    JSON.stringify(
      {
        env: {
          ASAAS_WEBHOOK_PUBLIC_BASE_URL: process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL || null,
          ASAAS_WEBHOOK_AUTH_TOKEN_SECRET: secret ? `set (${secret.length} chars)` : 'MISSING',
          ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS: process.env.ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS || 'false',
          FIN_WEBHOOK_ASYNC_ENABLED: process.env.FIN_WEBHOOK_ASYNC_ENABLED || 'false',
          FIN_WEBHOOK_INLINE_DRAIN: process.env.FIN_WEBHOOK_INLINE_DRAIN || '(default on in dev)',
          webhookProcessing: runtime,
          expectedWebhookUrl: webhookUrl,
          operationalWarnings,
        },
        account: {
          conta: account.financeProfile.conta.nome,
          contaId,
          financeProfileId: account.financeProfileId,
          asaasAccountId: account.asaasAccountId,
          webhookAuthTokenHash: account.webhookAuthTokenHash,
          expectedHash,
          hashMatch: account.webhookAuthTokenHash === expectedHash,
        },
        remoteWebhooks: (remoteWebhooks?.data || []).map((w: Record<string, unknown>) => ({
          id: w.id,
          name: w.name,
          url: w.url,
          enabled: w.enabled,
          interrupted: w.interrupted,
          hasAuthToken: w.hasAuthToken,
        })),
        localQueue: Object.fromEntries(queue.map((q) => [q.status, q._count._all])),
        rejections,
        recentWebhooks,
        recentCobrancas,
        recentCharges,
        remotePayments: (recentPayments?.data || []).slice(0, 8).map((p: Record<string, unknown>) => ({
          id: p.id,
          status: p.status,
          billingType: p.billingType,
          value: p.value,
          paymentDate: p.paymentDate,
          confirmedDate: p.confirmedDate,
          externalReference: p.externalReference,
        })),
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
