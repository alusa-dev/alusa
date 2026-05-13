import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { handleAsaasWebhookEvent } from '../asaas-webhook-handler';

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');
  return {
    ...actual,
    getMyAccountDocuments: vi.fn(),
  };
});

vi.mock('@alusa/database', async () => {
  const actual = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
  return {
    ...actual,
    prisma: actual.prisma,
    loadAsaasCredentials: vi.fn(async () => ({
      apiKey: 'sandbox_x',
      apiKeyStatus: 'CONNECTED',
      source: 'conta_legacy',
      webhookSecret: null,
    })),
  };
});

vi.mock('@alusa/lib', async () => {
  const actual = await vi.importActual<typeof import('@alusa/lib')>('@alusa/lib').catch(() => ({}));
  return {
    ...actual,
    createNotification: vi.fn().mockResolvedValue({ id: 'notification-1' }),
  };
});

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

interface TestContext {
  contaId: string;
  authToken: string;
}

async function setupTestAccount(): Promise<TestContext> {
  const unique = randomUUID();
  const conta = await prisma.conta.create({
    data: {
      nome: 'Conta Teste Webhook Critical',
      cpfCnpj: `00${unique.replaceAll('-', '').slice(0, 12)}`,
    },
  });

  await prisma.usuario.create({
    data: {
      contaId: conta.id,
      nome: 'Owner',
      email: `owner+${unique}@teste.com`,
      birthDate: new Date('1990-01-01T00:00:00.000Z'),
      senhaHash: 'hash',
      role: 'ADMIN',
    },
  });

  const profile = await prisma.financeProfile.create({
    data: {
      contaId: conta.id,
    },
  });

  const authToken = `token_${randomUUID()}`;
  await prisma.asaasAccount.create({
    data: {
      financeProfileId: profile.id,
      asaasAccountId: `asaas_${randomUUID()}`,
      externalReference: `financeProfile:${profile.id}`,
      status: 'IN_PROGRESS',
      statusUpdatedAt: new Date(),
      webhookAuthTokenHash: sha256Hex(authToken),
    },
  });

  return { contaId: conta.id, authToken };
}

async function cleanupTestAccount(contaId: string) {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: { id: true },
  });

  await prisma.webhookAsaas.deleteMany({ where: { contaId } });
  await prisma.asaasIntegrationJob.deleteMany({ where: { contaId } });
  await prisma.invoice.deleteMany({ where: { contaId } });
  await prisma.sale.deleteMany({ where: { contaId } });
  await prisma.chargeReadModel.deleteMany({ where: { contaId } });
  await prisma.charge.deleteMany({ where: { contaId } });

  if (profile) {
    await prisma.asaasAccount.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.financeProfile.deleteMany({ where: { contaId } });
  }

  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('Webhook Critical Tests - Idempotência', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestAccount();
  });

  afterEach(async () => {
    await cleanupTestAccount(ctx.contaId);
  });

  it('deve processar evento apenas uma vez com mesmo eventId', async () => {
    const eventId = `evt_${randomUUID()}`;
    const paymentId = `pay_${randomUUID()}`;

    const rawBody = JSON.stringify({
      id: eventId,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: paymentId,
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    // Primeira chamada - deve processar
    const first = await handleAsaasWebhookEvent({ rawBody, accessToken: ctx.authToken });
    expect(first.success).toBe(true);
    expect(first.status).toBe(200);

    const webhooksAfterFirst = await prisma.webhookAsaas.findMany({
      where: { contaId: ctx.contaId, eventId },
    });
    expect(webhooksAfterFirst.length).toBe(1);
    expect(webhooksAfterFirst[0].status).toBe('PROCESSADO');

    // Segunda chamada - deve retornar idempotente
    const second = await handleAsaasWebhookEvent({ rawBody, accessToken: ctx.authToken });
    expect(second.success).toBe(true);
    expect(second.status).toBe(200);
    expect(second.message).toBe('Evento já processado');

    // Não deve criar novo registro
    const webhooksAfterSecond = await prisma.webhookAsaas.findMany({
      where: { contaId: ctx.contaId, eventId },
    });
    expect(webhooksAfterSecond.length).toBe(1);
  });

  it('deve processar evento apenas uma vez com mesmo payloadHash (sem eventId)', async () => {
    const paymentId = `pay_${randomUUID()}`;

    // Payload sem eventId (fallback para payloadHash)
    const rawBody = JSON.stringify({
      event: 'PAYMENT_CREATED',
      payment: {
        id: paymentId,
        status: 'PENDING',
        value: 50,
        netValue: 50,
      },
    });

    // Primeira chamada
    const first = await handleAsaasWebhookEvent({ rawBody, accessToken: ctx.authToken });
    expect(first.success).toBe(true);

    const webhooksAfterFirst = await prisma.webhookAsaas.count({
      where: { contaId: ctx.contaId },
    });
    expect(webhooksAfterFirst).toBe(1);

    // Segunda chamada com mesmo payload
    const second = await handleAsaasWebhookEvent({ rawBody, accessToken: ctx.authToken });
    expect(second.success).toBe(true);
    expect(second.message).toBe('Evento já processado');

    // Não deve criar novo registro
    const webhooksAfterSecond = await prisma.webhookAsaas.count({
      where: { contaId: ctx.contaId },
    });
    expect(webhooksAfterSecond).toBe(1);
  });

  it('deve processar eventos diferentes com paymentId diferente', async () => {
    const paymentId1 = `pay_${randomUUID()}`;
    const paymentId2 = `pay_${randomUUID()}`;

    const rawBody1 = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: paymentId1,
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    const rawBody2 = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: paymentId2,
        status: 'CONFIRMED',
        value: 200,
        netValue: 190,
      },
    });

    const first = await handleAsaasWebhookEvent({ rawBody: rawBody1, accessToken: ctx.authToken });
    expect(first.success).toBe(true);

    const second = await handleAsaasWebhookEvent({ rawBody: rawBody2, accessToken: ctx.authToken });
    expect(second.success).toBe(true);

    const webhooks = await prisma.webhookAsaas.count({
      where: { contaId: ctx.contaId },
    });
    expect(webhooks).toBe(2);
  });

  it('deve tratar N chamadas concorrentes do mesmo evento', async () => {
    const eventId = `evt_${randomUUID()}`;
    const paymentId = `pay_${randomUUID()}`;

    const rawBody = JSON.stringify({
      id: eventId,
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: paymentId,
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    // Simular 5 chamadas concorrentes
    const promises = Array.from({ length: 5 }, () =>
      handleAsaasWebhookEvent({ rawBody, accessToken: ctx.authToken })
    );

    const results = await Promise.all(promises);

    // Todas devem retornar sucesso
    for (const result of results) {
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
    }

    // Pode haver concorrência no processamento, mas no final deve haver apenas 1 registro
    const webhooks = await prisma.webhookAsaas.findMany({
      where: { contaId: ctx.contaId, eventId },
    });
    expect(webhooks.length).toBe(1);
    expect(webhooks[0].status).toBe('PROCESSADO');
  });

  it('não colide mesmo eventId e payloadHash entre tenants diferentes', async () => {
    const other = await setupTestAccount();
    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: eventId,
      event: 'PAYMENT_CREATED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'PENDING',
        value: 100,
        netValue: 100,
      },
    });

    try {
      const first = await handleAsaasWebhookEvent({ rawBody, accessToken: ctx.authToken });
      const second = await handleAsaasWebhookEvent({ rawBody, accessToken: other.authToken });

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);

      const currentTenantCount = await prisma.webhookAsaas.count({
        where: { contaId: ctx.contaId, eventId },
      });
      const otherTenantCount = await prisma.webhookAsaas.count({
        where: { contaId: other.contaId, eventId },
      });

      expect(currentTenantCount).toBe(1);
      expect(otherTenantCount).toBe(1);
    } finally {
      await cleanupTestAccount(other.contaId);
    }
  });
});

describe('Webhook Critical Tests - Reordenação de Eventos', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestAccount();
  });

  afterEach(async () => {
    await cleanupTestAccount(ctx.contaId);
  });

  it('deve aceitar eventos fora de ordem cronológica', async () => {
    const paymentId = `pay_${randomUUID()}`;

    // Evento 2 chega primeiro (RECEIVED)
    const event2Body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: paymentId,
        status: 'RECEIVED',
        value: 100,
        netValue: 95,
      },
    });

    // Evento 1 chega depois (CREATED)
    const event1Body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_CREATED',
      payment: {
        id: paymentId,
        status: 'PENDING',
        value: 100,
        netValue: 100,
      },
    });

    // Evento 2 chega primeiro
    const result2 = await handleAsaasWebhookEvent({ rawBody: event2Body, accessToken: ctx.authToken });
    expect(result2.success).toBe(true);

    // Evento 1 chega depois
    const result1 = await handleAsaasWebhookEvent({ rawBody: event1Body, accessToken: ctx.authToken });
    expect(result1.success).toBe(true);

    // Ambos devem ser registrados
    const webhooks = await prisma.webhookAsaas.findMany({
      where: { contaId: ctx.contaId },
      orderBy: { recebidoEm: 'asc' },
    });
    expect(webhooks.length).toBe(2);
    expect(webhooks[0].evento).toBe('PAYMENT_RECEIVED');
    expect(webhooks[1].evento).toBe('PAYMENT_CREATED');
  });

  it('deve registrar todos os eventos mesmo com status "atrasado"', async () => {
    const paymentId = `pay_${randomUUID()}`;

    // Fluxo normal: CREATED -> OVERDUE -> CONFIRMED -> RECEIVED
    // Chegam: RECEIVED, OVERDUE, CREATED, CONFIRMED (totalmente fora de ordem)
    const events = [
      { event: 'PAYMENT_RECEIVED', status: 'RECEIVED' },
      { event: 'PAYMENT_OVERDUE', status: 'OVERDUE' },
      { event: 'PAYMENT_CREATED', status: 'PENDING' },
      { event: 'PAYMENT_CONFIRMED', status: 'CONFIRMED' },
    ];

    for (const { event, status } of events) {
      const rawBody = JSON.stringify({
        id: `evt_${randomUUID()}`,
        event,
        payment: {
          id: paymentId,
          status,
          value: 100,
          netValue: 95,
        },
      });

      const result = await handleAsaasWebhookEvent({ rawBody, accessToken: ctx.authToken });
      expect(result.success).toBe(true);
    }

    const webhooks = await prisma.webhookAsaas.findMany({
      where: { contaId: ctx.contaId },
    });
    expect(webhooks.length).toBe(4);

    // Todos devem estar processados
    for (const webhook of webhooks) {
      expect(webhook.status).toBe('PROCESSADO');
    }
  });
});

describe('Webhook Critical Tests - Validação de Origem', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestAccount();
  });

  afterEach(async () => {
    await cleanupTestAccount(ctx.contaId);
  });

  it('deve rejeitar webhook com token inválido', async () => {
    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    const result = await handleAsaasWebhookEvent({
      rawBody,
      accessToken: 'invalid_token_123',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toBe('Assinatura inválida');

    // Não deve criar registro
    const webhooks = await prisma.webhookAsaas.count({
      where: { contaId: ctx.contaId },
    });
    expect(webhooks).toBe(0);
  });

  it('deve rejeitar webhook sem token', async () => {
    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    const result = await handleAsaasWebhookEvent({
      rawBody,
      accessToken: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe('Assinatura inválida');
  });

  it('deve aceitar webhook com token correto', async () => {
    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_CREATED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'PENDING',
        value: 100,
        netValue: 100,
      },
    });

    const result = await handleAsaasWebhookEvent({
      rawBody,
      accessToken: ctx.authToken,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
  });

  it('deve aceitar token anterior dentro da janela de rotação', async () => {
    const previousToken = `token_${randomUUID()}`;
    const profile = await prisma.financeProfile.findUniqueOrThrow({
      where: { contaId: ctx.contaId },
      select: { id: true },
    });
    await prisma.asaasAccount.update({
      where: { financeProfileId: profile.id },
      data: {
        previousWebhookAuthTokenHash: sha256Hex(previousToken),
        previousWebhookAuthTokenExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_CREATED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'PENDING',
        value: 100,
        netValue: 100,
      },
    });

    const result = await handleAsaasWebhookEvent({
      rawBody,
      accessToken: previousToken,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
  });

  it('deve rejeitar token anterior expirado', async () => {
    const previousToken = `token_${randomUUID()}`;
    const profile = await prisma.financeProfile.findUniqueOrThrow({
      where: { contaId: ctx.contaId },
      select: { id: true },
    });
    await prisma.asaasAccount.update({
      where: { financeProfileId: profile.id },
      data: {
        previousWebhookAuthTokenHash: sha256Hex(previousToken),
        previousWebhookAuthTokenExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_CREATED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'PENDING',
        value: 100,
        netValue: 100,
      },
    });

    const result = await handleAsaasWebhookEvent({
      rawBody,
      accessToken: previousToken,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('Webhook Critical Tests - Tentativas e Reprocessamento', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestAccount();
  });

  afterEach(async () => {
    await cleanupTestAccount(ctx.contaId);
  });

  it('deve respeitar limite de tentativas', async () => {
    const eventId = `evt_${randomUUID()}`;

    // Criar webhook com tentativas no limite
    await prisma.webhookAsaas.create({
      data: {
        contaId: ctx.contaId,
        eventId,
        evento: 'PAYMENT_RECEIVED',
        payload: { test: true },
        payloadHash: sha256Hex(JSON.stringify({ test: true })),
        status: 'ERRO',
        tentativas: 5, // Limite padrão
        ultimaTentativaEm: new Date(),
      },
    });

    const rawBody = JSON.stringify({
      id: eventId,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    const result = await handleAsaasWebhookEvent({
      rawBody,
      accessToken: ctx.authToken,
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Evento ignorado (limite de tentativas excedido)');

    // Não deve incrementar tentativas
    const webhook = await prisma.webhookAsaas.findFirst({ where: { contaId: ctx.contaId, eventId } });
    expect(webhook?.tentativas).toBe(5);
  });

  it('deve registrar attemptsLog para auditoria', async () => {
    const eventId = `evt_${randomUUID()}`;

    const rawBody = JSON.stringify({
      id: eventId,
      event: 'PAYMENT_CREATED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'PENDING',
        value: 100,
        netValue: 100,
      },
    });

    await handleAsaasWebhookEvent({ rawBody, accessToken: ctx.authToken });

    const webhook = await prisma.webhookAsaas.findFirst({ where: { contaId: ctx.contaId, eventId } });
    expect(webhook).not.toBeNull();
    expect(webhook?.attemptsLog).toBeDefined();
    expect(Array.isArray(webhook?.attemptsLog)).toBe(true);

    const log = webhook?.attemptsLog as unknown[];
    expect(log.length).toBeGreaterThanOrEqual(1);

    const firstAttempt = log[0] as { at: string; ok: boolean; status: string; duracaoMs: number };
    expect(firstAttempt).toHaveProperty('at');
    expect(firstAttempt).toHaveProperty('ok');
    expect(firstAttempt).toHaveProperty('status');
    expect(firstAttempt).toHaveProperty('duracaoMs');
  });
});

describe('Webhook Critical Tests - Eventos Desconhecidos', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestAccount();
  });

  afterEach(async () => {
    await cleanupTestAccount(ctx.contaId);
  });

  it('deve aceitar e registrar eventos desconhecidos (fallback)', async () => {
    const eventId = `evt_${randomUUID()}`;

    // Evento fictício que não existe no Asaas
    const rawBody = JSON.stringify({
      id: eventId,
      event: 'UNKNOWN_FUTURE_EVENT',
      data: {
        id: `xxx_${randomUUID()}`,
      },
    });

    const result = await handleAsaasWebhookEvent({
      rawBody,
      accessToken: ctx.authToken,
    });

    // Deve aceitar (fallback genérico)
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);

    // Deve registrar para auditoria
    const webhook = await prisma.webhookAsaas.findFirst({ where: { contaId: ctx.contaId, eventId } });
    expect(webhook).not.toBeNull();
    expect(webhook?.evento).toBe('UNKNOWN_FUTURE_EVENT');
    expect(webhook?.status).toBe('PROCESSADO');
  });

  it('deve aceitar eventos de categorias não utilizadas (INVOICE, BILL, etc.)', async () => {
    const eventId = `evt_${randomUUID()}`;

    const rawBody = JSON.stringify({
      id: eventId,
      event: 'INVOICE_CREATED',
      invoice: {
        id: `inv_${randomUUID()}`,
      },
    });

    const result = await handleAsaasWebhookEvent({
      rawBody,
      accessToken: ctx.authToken,
    });

    // Deve aceitar mesmo sem handler específico
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);

    const webhook = await prisma.webhookAsaas.findFirst({ where: { contaId: ctx.contaId, eventId } });
    expect(webhook?.evento).toBe('INVOICE_CREATED');
  });
});
