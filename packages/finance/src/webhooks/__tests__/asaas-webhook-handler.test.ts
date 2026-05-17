import { describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import { handleAsaasWebhookEvent } from '../asaas-webhook-handler';

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
  await prisma.logIntegracao.deleteMany({ where: { contaId } });
  await prisma.asaasIntegrationJob.deleteMany({ where: { contaId } });
  await prisma.invoice.deleteMany({ where: { contaId } });
  await prisma.sale.deleteMany({ where: { contaId } });
  await prisma.chargeReadModel.deleteMany({ where: { contaId } });
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
