import { describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { enqueueAsaasWebhookEvent, handleAsaasWebhookEvent } from '../asaas-webhook-handler';
import { claimTenantFairAsaasWebhooks, processAsaasWebhookQueue } from '../asaas-webhook-handler.server';
import { recoverStuckWebhooks } from '../webhook-reconciliation.service';

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');
  return {
    ...actual,
    getMyAccountDocuments: vi.fn(),
    getMyAccountStatus: vi.fn().mockResolvedValue({
      general: 'PENDING',
      documentation: 'PENDING',
      bankAccountInfo: 'PENDING',
    }),
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

async function cleanup(contaId: string) {
  const profile = await prisma.financeProfile.findUnique({ where: { contaId }, select: { id: true } });

  await prisma.webhookAsaas.deleteMany({ where: { contaId } });
  await prisma.financeReconciliationIssue.deleteMany({ where: { contaId } });
  await prisma.asaasResourceOrigin.deleteMany({ where: { contaId } });
  await prisma.logIntegracao.deleteMany({ where: { contaId } });
  await prisma.asaasIntegrationJob.deleteMany({ where: { contaId } });
  await prisma.invoice.deleteMany({ where: { contaId } });
  await prisma.sale.deleteMany({ where: { contaId } });
  await prisma.chargeReadModel.deleteMany({ where: { contaId } });
  await prisma.financePaymentStateTransition.deleteMany({ where: { contaId } });
  await prisma.charge.deleteMany({ where: { contaId } });
  await prisma.lancamento.deleteMany({ where: { contaId } });
  await prisma.pagamento.deleteMany({ where: { cobranca: { matricula: { aluno: { contaId } } } } });
  await prisma.cobranca.deleteMany({ where: { matricula: { aluno: { contaId } } } });
  await prisma.matricula.deleteMany({ where: { aluno: { contaId } } });
  await prisma.aluno.deleteMany({ where: { contaId } });

  if (profile) {
    await prisma.asaasAccount.deleteMany({ where: { financeProfileId: profile.id } });
    await prisma.financeProfile.deleteMany({ where: { contaId } });
  }

  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

describe('handleAsaasWebhookEvent (Fase 2 - authToken)', () => {
  it('finalizes a SQL-claimed webhook despite PostgreSQL timestamp precision', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Precisão',
        cpfCnpj: `000000000004${String(Date.now()).slice(-2)}`,
      },
    });
    const eventId = `evt_${randomUUID()}`;
    const hook = await prisma.webhookAsaas.create({
      data: {
        contaId: conta.id,
        evento: 'UNROUTED_TEST_EVENT',
        eventId,
        payload: { id: eventId, event: 'UNROUTED_TEST_EVENT' },
        status: 'PENDENTE',
        tentativas: 0,
      },
    });

    try {
      const result = await processAsaasWebhookQueue({ contaId: conta.id, webhookId: hook.id });
      const persisted = await prisma.webhookAsaas.findUnique({ where: { id: hook.id } });

      expect(result).toMatchObject({ attempted: 1, processed: 1, failed: 0, skipped: 0 });
      expect(persisted).toMatchObject({ status: 'PROCESSADO', tentativas: 1 });
      expect(persisted?.ultimaTentativaEm).toBeInstanceOf(Date);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('recovers stale rows with PostgreSQL precision and preserves a newer processing attempt', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Recovery',
        cpfCnpj: `000000000005${String(Date.now()).slice(-2)}`,
      },
    });
    const oldDate = new Date(Date.now() - 10 * 60_000);
    const hook = await prisma.webhookAsaas.create({
      data: {
        contaId: conta.id,
        evento: 'UNROUTED_TEST_EVENT',
        eventId: `evt_${randomUUID()}`,
        payload: { event: 'UNROUTED_TEST_EVENT' },
        status: 'PROCESSANDO',
        tentativas: 2,
        recebidoEm: oldDate,
        ultimaTentativaEm: oldDate,
      },
    });
    const recoverableHook = await prisma.webhookAsaas.create({
      data: {
        contaId: conta.id,
        evento: 'UNROUTED_TEST_EVENT',
        eventId: `evt_${randomUUID()}`,
        payload: { event: 'UNROUTED_TEST_EVENT' },
        status: 'PROCESSANDO',
        tentativas: 4,
        recebidoEm: oldDate,
        ultimaTentativaEm: oldDate,
      },
    });
    const actualFindMany = prisma.webhookAsaas.findMany.bind(prisma.webhookAsaas);
    prisma.webhookAsaas.findMany = async (args) => {
      const rows = await actualFindMany(args);
      if (rows.some((row) => row.id === hook.id)) {
        await prisma.webhookAsaas.update({
          where: { id: hook.id },
          data: { tentativas: { increment: 1 }, ultimaTentativaEm: new Date() },
        });
      }
      return rows;
    };

    try {
      const result = await recoverStuckWebhooks({ contaId: conta.id, timeoutMinutes: 5 });
      const persisted = await prisma.webhookAsaas.findUnique({ where: { id: hook.id } });
      const recovered = await prisma.webhookAsaas.findUnique({ where: { id: recoverableHook.id } });

      expect(result).toMatchObject({ recovered: 1, ids: [recoverableHook.id] });
      expect(persisted).toMatchObject({ status: 'PROCESSANDO', tentativas: 3 });
      expect(persisted?.ultimaTentativaEm?.getTime()).toBeGreaterThan(oldDate.getTime());
      expect(recovered).toMatchObject({ status: 'ERRO', tentativas: 4 });
    } finally {
      prisma.webhookAsaas.findMany = actualFindMany;
      await cleanup(conta.id);
    }
  });

  it('does not let an old worker finalize a webhook after a newer claim takes over', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Claim',
        cpfCnpj: `000000000003${String(Date.now()).slice(-2)}`,
      },
    });
    const eventId = `evt_${randomUUID()}`;
    const hook = await prisma.webhookAsaas.create({
      data: {
        contaId: conta.id,
        evento: 'PAYMENT_RECEIVED',
        eventId,
        payload: { id: eventId, event: 'PAYMENT_RECEIVED', payment: { id: `pay_${randomUUID()}` } },
        status: 'PENDENTE',
        tentativas: 0,
      },
    });

    const actualUpdateMany = prisma.webhookAsaas.updateMany.bind(prisma.webhookAsaas);
    prisma.webhookAsaas.updateMany = async (args) => {
      if ((args?.where as { id?: string } | undefined)?.id === hook.id) {
        await actualUpdateMany({
          where: { id: hook.id, status: 'PROCESSANDO' },
          data: { tentativas: { increment: 1 }, ultimaTentativaEm: new Date(Date.now() + 1_000) },
        });
      }
      return actualUpdateMany(args);
    };

    try {
      const result = await processAsaasWebhookQueue({ contaId: conta.id, webhookId: hook.id });
      const persisted = await prisma.webhookAsaas.findUnique({ where: { id: hook.id } });

      expect(result).toMatchObject({ attempted: 1, processed: 0, failed: 0, skipped: 1 });
      expect(persisted).toMatchObject({ status: 'PROCESSANDO', tentativas: 2 });
      expect(persisted?.ultimoErro).toBeNull();
    } finally {
      prisma.webhookAsaas.updateMany = actualUpdateMany;
      await cleanup(conta.id);
    }
  });

  it('fences a recycled attempt number with a strictly increasing database claim timestamp', async () => {
    const conta = await prisma.conta.create({
      data: { nome: 'Conta Claim Fence', cpfCnpj: `000000000006${String(Date.now()).slice(-2)}` },
    });
    const previousClaimAt = new Date(Date.now() - 2_000);
    const hook = await prisma.webhookAsaas.create({
      data: {
        contaId: conta.id,
        evento: 'UNROUTED_TEST_EVENT',
        eventId: `evt_${randomUUID()}`,
        payload: { event: 'UNROUTED_TEST_EVENT' },
        status: 'ERRO',
        tentativas: 0,
        ultimaTentativaEm: previousClaimAt,
      },
    });

    try {
      const firstClaim = await prisma.$transaction((tx) => claimTenantFairAsaasWebhooks(tx, {
        statuses: ['ERRO'], maxAttempts: 5, limit: 1,
      }));
      expect(firstClaim).toHaveLength(1);
      expect(firstClaim[0]?.tentativas).toBe(1);

      // ALUSA classification resets only the replay budget. The old claim's
      // timestamp remains the lower bound for the next fencing token.
      await prisma.webhookAsaas.updateMany({
        where: { id: hook.id, contaId: conta.id, status: 'PROCESSANDO', tentativas: 1 },
        data: { status: 'ERRO', tentativas: 0 },
      });

      const secondClaim = await prisma.$transaction((tx) => claimTenantFairAsaasWebhooks(tx, {
        statuses: ['ERRO'], maxAttempts: 5, limit: 1,
      }));
      expect(secondClaim).toHaveLength(1);
      expect(secondClaim[0]?.tentativas).toBe(1);
      expect(secondClaim[0]!.ultimaTentativaEm.getTime()).toBeGreaterThan(firstClaim[0]!.ultimaTentativaEm.getTime());

      const staleFinalizer = await prisma.webhookAsaas.updateMany({
        where: {
          id: hook.id,
          contaId: conta.id,
          status: 'PROCESSANDO',
          tentativas: firstClaim[0]!.tentativas,
          ultimaTentativaEm: firstClaim[0]!.ultimaTentativaEm,
        },
        data: { status: 'PROCESSADO', processadoEm: new Date() },
      });
      expect(staleFinalizer.count).toBe(0);
      const persisted = await prisma.webhookAsaas.findUnique({ where: { id: hook.id } });
      expect(persisted).toMatchObject({ status: 'PROCESSANDO', tentativas: 1 });
      expect(persisted?.ultimaTentativaEm?.getTime()).toBe(secondClaim[0]!.ultimaTentativaEm.getTime());
    } finally {
      await cleanup(conta.id);
    }
  });

  it('uses the timestamp fence when the normal queue recycles attempt one', async () => {
    const conta = await prisma.conta.create({
      data: { nome: 'Conta Normal Claim Fence', cpfCnpj: `000000000007${String(Date.now()).slice(-2)}` },
    });
    const eventId = `evt_${randomUUID()}`;
    const hook = await prisma.webhookAsaas.create({
      data: {
        contaId: conta.id,
        evento: 'UNROUTED_TEST_EVENT',
        eventId,
        payload: { id: eventId, event: 'UNROUTED_TEST_EVENT' },
        status: 'ERRO',
        tentativas: 0,
      },
    });

    const actualUpdateMany = prisma.webhookAsaas.updateMany.bind(prisma.webhookAsaas);
    let replayed = false;
    prisma.webhookAsaas.updateMany = async (args) => {
      const where = args?.where as { id?: string; ultimaTentativaEm?: Date } | undefined;
      if (!replayed && where?.id === hook.id && where.ultimaTentativaEm instanceof Date) {
        replayed = true;
        const firstClaimAt = where.ultimaTentativaEm;
        await actualUpdateMany({
          where: { id: hook.id, contaId: conta.id, status: 'PROCESSANDO', tentativas: 1 },
          data: { status: 'ERRO', tentativas: 0 },
        });
        prisma.webhookAsaas.updateMany = actualUpdateMany;
        const secondRun = await processAsaasWebhookQueue({ contaId: conta.id, webhookId: hook.id });
        expect(secondRun).toMatchObject({ attempted: 1, processed: 1, skipped: 0 });
        const newerClaimAt = (await prisma.webhookAsaas.findUnique({ where: { id: hook.id } }))?.ultimaTentativaEm;
        expect(newerClaimAt?.getTime()).toBeGreaterThan(firstClaimAt.getTime());
        return actualUpdateMany(args);
      }
      return actualUpdateMany(args);
    };

    try {
      const firstRun = await processAsaasWebhookQueue({ contaId: conta.id, webhookId: hook.id });
      const persisted = await prisma.webhookAsaas.findUnique({ where: { id: hook.id } });

      expect(firstRun).toMatchObject({ attempted: 1, processed: 0, skipped: 1 });
      expect(persisted).toMatchObject({ status: 'PROCESSADO', tentativas: 1 });
    } finally {
      prisma.webhookAsaas.updateMany = actualUpdateMany;
      await cleanup(conta.id);
    }
  });

  it('does not requeue an errored webhook claimed concurrently after the initial read', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
      },
    });
    const profile = await prisma.financeProfile.create({ data: { contaId: conta.id } });
    const authToken = `token_${randomUUID()}`;
    await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile.id,
        asaasAccountId: `asaas_${randomUUID()}`,
        externalReference: `financeProfile:${profile.id}`,
        status: 'APPROVED',
        statusUpdatedAt: new Date(),
        webhookAuthTokenHash: sha256Hex(authToken),
      },
    });
    const eventId = `evt_${randomUUID()}`;
    const hook = await prisma.webhookAsaas.create({
      data: {
        contaId: conta.id,
        evento: 'PAYMENT_RECEIVED',
        eventId,
        payload: { id: eventId, event: 'PAYMENT_RECEIVED' },
        status: 'ERRO',
        tentativas: 1,
      },
    });
    const otherConta = await prisma.conta.create({
      data: {
        nome: 'Outra Conta',
        cpfCnpj: `000000000002${String(Date.now()).slice(-2)}`,
      },
    });
    const otherHook = await prisma.webhookAsaas.create({
      data: {
        contaId: otherConta.id,
        evento: 'PAYMENT_RECEIVED',
        eventId,
        payload: { id: eventId, event: 'PAYMENT_RECEIVED' },
        status: 'ERRO',
        tentativas: 1,
      },
    });

    const actualUpdateMany = prisma.webhookAsaas.updateMany.bind(prisma.webhookAsaas);
    prisma.webhookAsaas.updateMany = async (args) => {
      // Deterministically place a worker claim between the enqueue read and CAS.
      await actualUpdateMany({
        where: { id: hook.id },
        data: { status: 'PROCESSANDO', tentativas: { increment: 1 }, ultimaTentativaEm: new Date() },
      });
      return actualUpdateMany(args);
    };

    try {
      const result = await enqueueAsaasWebhookEvent({
        rawBody: JSON.stringify({ id: eventId, event: 'PAYMENT_RECEIVED' }),
        accessToken: authToken,
      });

      expect(result).toMatchObject({ success: true, persisted: true, webhookId: hook.id });
      const persisted = await prisma.webhookAsaas.findUnique({ where: { id: hook.id } });
      expect(persisted?.status).toBe('PROCESSANDO');
      expect(persisted?.tentativas).toBe(2);
      const otherPersisted = await prisma.webhookAsaas.findUnique({ where: { id: otherHook.id } });
      expect(otherPersisted?.status).toBe('ERRO');
      expect(otherPersisted?.tentativas).toBe(1);
    } finally {
      prisma.webhookAsaas.updateMany = actualUpdateMany;
      await cleanup(conta.id);
      await cleanup(otherConta.id);
    }
  });

  it('deve rejeitar JSON inválido', async () => {
    const res = await handleAsaasWebhookEvent({ rawBody: '{', accessToken: `token_${randomUUID()}` });
    expect(res).toMatchObject({ success: false, status: 400 });
  });

  it('deve rejeitar quando event não é informado', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
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

    const rawBody = JSON.stringify({ id: `evt_${randomUUID()}` });

    try {
      const res = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(res).toMatchObject({ success: false, status: 400 });
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve autorizar por authToken hash e ser idempotente por eventId', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
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

    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: eventId,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'CONFIRMED',
        value: 10,
        netValue: 9,
      },
    });

    try {
      const first = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(first).toMatchObject({ success: true, status: 200 });

      const countAfterFirst = await prisma.webhookAsaas.count({ where: { contaId: conta.id, eventId } });
      expect(countAfterFirst).toBe(1);

      const second = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(second).toMatchObject({ success: true, status: 200, message: 'Evento já processado' });

      const countAfterSecond = await prisma.webhookAsaas.count({ where: { contaId: conta.id, eventId } });
      expect(countAfterSecond).toBe(1);
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve rejeitar quando authToken não corresponde a nenhum tenant', async () => {
    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: `pay_${randomUUID()}`,
        status: 'CONFIRMED',
        value: 10,
        netValue: 9,
      },
    });

    const res = await handleAsaasWebhookEvent({ rawBody, accessToken: `bad_${randomUUID()}` });
    expect(res).toMatchObject({ success: false, status: 403 });
  });

  it('deve aceitar evento desconhecido (sem handler dedicado) e registrar como processado', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
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

    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: eventId,
      event: 'TRANSFER_CREATED',
      transfer: {
        id: `tr_${randomUUID()}`,
      },
    });

    try {
      const res = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(res).toMatchObject({ success: true, status: 200 });

      const record = await prisma.webhookAsaas.findFirst({ where: { contaId: conta.id, eventId } });
      expect(record).not.toBeNull();
      expect(record?.contaId).toBe(conta.id);
      expect(record?.status).toBe('PROCESSADO');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve criar pagamento e lancamento quando liquidado', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
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
      data: { contaId: conta.id },
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

    const aluno = await prisma.aluno.create({
      data: {
        contaId: conta.id,
        nome: 'Aluno Teste',
        dataNasc: new Date('2010-01-01T00:00:00.000Z'),
      },
    });

    const matricula = await prisma.matricula.create({
      data: {
        contaId: conta.id,
        alunoId: aluno.id,
        dataInicio: new Date('2025-01-01T00:00:00.000Z'),
        dataFimContrato: new Date('2026-01-01T00:00:00.000Z'),
        taxaMatricula: 0,
      },
    });

    const paymentId = `pay_${randomUUID()}`;
    await prisma.cobranca.create({
      data: {
        contaId: conta.id,
        matriculaId: matricula.id,
        competenciaInicio: new Date('2025-01-01T00:00:00.000Z'),
        competenciaFim: new Date('2025-01-31T00:00:00.000Z'),
        valor: 150,
        vencimento: new Date('2025-02-05T00:00:00.000Z'),
        formaPagamento: 'PIX',
        status: 'PENDENTE',
        tipo: 'MENSALIDADE',
        asaasPaymentId: paymentId,
      },
    });

    await prisma.asaasResourceOrigin.create({
      data: {
        contaId: conta.id,
        resourceType: 'PAYMENT',
        asaasId: paymentId,
        origin: 'ALUSA',
        reason: 'operator_classification',
        actorId: 'admin-test',
      },
    });
    await prisma.financeReconciliationIssue.create({
      data: {
        contaId: conta.id,
        entityType: 'PAYMENT',
        asaasId: paymentId,
        issueType: 'PAYMENT_NEEDS_REVIEW',
        severity: 'MEDIUM',
        dedupeKey: `PAYMENT_NEEDS_REVIEW:PAYMENT:${paymentId}`,
        metadata: { reason: 'resource_origin_unknown' },
      },
    });

    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: eventId,
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: paymentId,
        status: 'CONFIRMED',
        value: 150,
        netValue: 139.18,
        creditDate: new Date().toISOString(),
      },
    });

    try {
      const res = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(res).toMatchObject({ success: true, status: 200 });

      const pagamento = await prisma.pagamento.findFirst({ where: { asaasPaymentId: paymentId } });
      expect(pagamento).not.toBeNull();

      const lancamento = await prisma.lancamento.findFirst({
        where: { contaId: conta.id, externalRef: `asaas:payment:${paymentId}`, isEstorno: false },
      });
      expect(lancamento).not.toBeNull();

      const issue = await prisma.financeReconciliationIssue.findFirst({
        where: { contaId: conta.id, asaasId: paymentId, issueType: 'PAYMENT_NEEDS_REVIEW' },
      });
      expect(issue).toMatchObject({ status: 'RESOLVED' });
      expect(issue?.resolution).toContain('classificado como ALUSA');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('mantém PAYMENT_NEEDS_REVIEW aberto quando o replay bem-sucedido ainda não tem origem ALUSA', async () => {
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Origem Desconhecida',
        cpfCnpj: `000000000006${String(Date.now()).slice(-2)}`,
      },
    });
    const profile = await prisma.financeProfile.create({ data: { contaId: conta.id } });
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

    const paymentId = `pay_${randomUUID()}`;
    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: eventId,
      event: 'PAYMENT_CONFIRMED',
      payment: { id: paymentId, status: 'CONFIRMED', value: 150 },
    });

    try {
      const result = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(result).toMatchObject({ success: true, status: 200 });

      const issue = await prisma.financeReconciliationIssue.findFirst({
        where: { contaId: conta.id, asaasId: paymentId, issueType: 'PAYMENT_NEEDS_REVIEW' },
      });
      expect(issue).toMatchObject({ status: 'OPEN' });
      expect(issue?.metadata).toMatchObject({ reason: 'resource_origin_unknown' });
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve processar ACCOUNT_STATUS_* e atualizar status + histórico', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
        financeStatus: 'FINANCE_IN_ANALYSIS',
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
    const asaasAccount = await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile.id,
        asaasAccountId: `asaas_${randomUUID()}`,
        externalReference: `financeProfile:${profile.id}`,
        status: 'IN_PROGRESS',
        statusUpdatedAt: new Date(),
        webhookAuthTokenHash: sha256Hex(authToken),
      },
      select: { id: true },
    });

    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: eventId,
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
    });

    try {
      const res = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(res).toMatchObject({ success: true, status: 200 });

      const updatedAsaasAccount = await prisma.asaasAccount.findUnique({
        where: { id: asaasAccount.id },
        select: { status: true },
      });
      expect(updatedAsaasAccount?.status).toBe('APPROVED');

      const updatedConta = await prisma.conta.findUnique({
        where: { id: conta.id },
        select: { financeStatus: true },
      });
      expect(updatedConta?.financeStatus).toBe('FINANCE_APPROVED');

      const history = await prisma.asaasAccountStatusHistory.findMany({
        where: { asaasAccountId: asaasAccount.id },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
        payloadId: eventId,
        oldStatus: 'IN_PROGRESS',
        newStatus: 'APPROVED',
      });
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve registrar expiração de dados comerciais sem alterar status geral', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
        financeStatus: 'FINANCE_APPROVED',
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
    const asaasAccount = await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile.id,
        asaasAccountId: `asaas_${randomUUID()}`,
        externalReference: `financeProfile:${profile.id}`,
        status: 'APPROVED',
        statusUpdatedAt: new Date(),
        webhookAuthTokenHash: sha256Hex(authToken),
      },
      select: { id: true },
    });

    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: eventId,
      event: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON',
      additionalInfo: { scheduledDate: '2025-06-20' },
    });

    try {
      const res = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(res).toMatchObject({ success: true, status: 200 });

      const updatedAsaasAccount = await prisma.asaasAccount.findUnique({
        where: { id: asaasAccount.id },
        select: { status: true, commercialInfoStatus: true, commercialInfoScheduledDate: true },
      });

      expect(updatedAsaasAccount?.status).toBe('APPROVED');
      expect(updatedAsaasAccount?.commercialInfoStatus).toBe('EXPIRING_SOON');
      expect(updatedAsaasAccount?.commercialInfoScheduledDate).toBe('2025-06-20');

      const updatedConta = await prisma.conta.findUnique({
        where: { id: conta.id },
        select: { financeStatus: true },
      });
      expect(updatedConta?.financeStatus).toBe('FINANCE_APPROVED');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve atualizar cache de documentos quando ACCOUNT_STATUS_DOCUMENT_* chega', async () => {
    const { getMyAccountDocuments } = await import('@alusa/asaas');

    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
        asaasApiKeyEncrypted: `v1:${Buffer.from('sandbox_x').toString('base64')}`,
        financeStatus: 'FINANCE_IN_ANALYSIS',
      },
    });

    const profile = await prisma.financeProfile.create({
      data: {
        contaId: conta.id,
      },
    });

    const authToken = `token_${randomUUID()}`;
    const asaasAccount = await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile.id,
        asaasAccountId: `asaas_${randomUUID()}`,
        externalReference: `financeProfile:${profile.id}`,
        status: 'IN_PROGRESS',
        statusUpdatedAt: new Date(),
        webhookAuthTokenHash: sha256Hex(authToken),
      },
      select: { id: true },
    });

    vi.mocked(getMyAccountDocuments).mockResolvedValueOnce({
      object: 'list',
      data: [
        {
          id: 'grp_1',
          status: 'PENDING',
          type: 'IDENTIFICATION',
          title: 'Documento',
          documents: [{ id: 'doc_1', status: 'PENDING', type: 'IDENTIFICATION' }],
        },
      ],
      rejectReasons: [],
    } as never);

    const rawBody = JSON.stringify({
      id: `evt_${randomUUID()}`,
      event: 'ACCOUNT_STATUS_DOCUMENT_APPROVED',
    });

    try {
      const res = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(res).toMatchObject({ success: true, status: 200 });

      expect(getMyAccountDocuments).toHaveBeenCalled();

      const refreshed = await prisma.asaasAccount.findUnique({
        where: { id: asaasAccount.id },
        select: { documentsCache: true, documentsCacheUpdatedAt: true },
      });

      expect(refreshed?.documentsCache).toBeTruthy();
      expect(refreshed?.documentsCacheUpdatedAt).not.toBeNull();
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve processar BALANCE_VALUE_BLOCKED e registrar webhook como PROCESSADO', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
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

    const profile = await prisma.financeProfile.create({ data: { contaId: conta.id } });

    const authToken = `token_${randomUUID()}`;
    await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile.id,
        asaasAccountId: `asaas_${randomUUID()}`,
        externalReference: `financeProfile:${profile.id}`,
        status: 'APPROVED',
        statusUpdatedAt: new Date(),
        webhookAuthTokenHash: sha256Hex(authToken),
      },
    });

    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({ id: eventId, event: 'BALANCE_VALUE_BLOCKED' });

    try {
      const res = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(res).toMatchObject({ success: true, status: 200 });

      const record = await prisma.webhookAsaas.findFirst({ where: { contaId: conta.id, eventId } });
      expect(record?.status).toBe('PROCESSADO');
    } finally {
      await cleanup(conta.id);
    }
  });

  it('deve processar ACCESS_TOKEN_EXPIRED e registrar webhook como PROCESSADO', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Teste',
        cpfCnpj: `000000000001${String(Date.now()).slice(-2)}`,
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

    const profile = await prisma.financeProfile.create({ data: { contaId: conta.id } });

    const authToken = `token_${randomUUID()}`;
    await prisma.asaasAccount.create({
      data: {
        financeProfileId: profile.id,
        asaasAccountId: `asaas_${randomUUID()}`,
        externalReference: `financeProfile:${profile.id}`,
        status: 'APPROVED',
        statusUpdatedAt: new Date(),
        webhookAuthTokenHash: sha256Hex(authToken),
      },
    });

    const eventId = `evt_${randomUUID()}`;
    const rawBody = JSON.stringify({ id: eventId, event: 'ACCESS_TOKEN_EXPIRED' });

    try {
      const res = await handleAsaasWebhookEvent({ rawBody, accessToken: authToken });
      expect(res).toMatchObject({ success: true, status: 200 });

      const record = await prisma.webhookAsaas.findFirst({ where: { contaId: conta.id, eventId } });
      expect(record?.status).toBe('PROCESSADO');

      const account = await prisma.asaasAccount.findUnique({
        where: { financeProfileId: profile.id },
        select: { apiKeyStatus: true, operationalStatus: true },
      });
      expect(account?.apiKeyStatus).toBe('EXPIRED');
      expect(account?.operationalStatus).toBe('API_KEY_REQUIRED');
    } finally {
      await cleanup(conta.id);
    }
  });
});
