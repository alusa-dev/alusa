import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  decryptSecret: vi.fn((value: string) => value),
  emailFindMany: vi.fn(),
  emailFindFirst: vi.fn(),
  emailUpdateMany: vi.fn(),
  contractFindFirst: vi.fn(),
  manualContractFindFirst: vi.fn(),
  emailUpsert: vi.fn(),
  auditCreate: vi.fn(),
  enqueueManualEmail: vi.fn(),
}));

vi.mock('@/lib/email/transactional-email', () => ({ sendTransactionalEmail: mocks.sendTransactionalEmail }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: (_contaId: string, callback: (tx: unknown) => unknown) => callback({
  contractEmailNotification: { findMany: mocks.emailFindMany, findFirst: mocks.emailFindFirst, updateMany: mocks.emailUpdateMany, upsert: mocks.emailUpsert },
  contrato: { findFirst: (args: { where?: { tokenPublicoHash?: string } }) => args.where?.tokenPublicoHash ? mocks.contractFindFirst(args) : mocks.manualContractFindFirst(args) },
  auditLog: { create: mocks.auditCreate },
}) }));
vi.mock('./contract-email-queue', () => ({ enqueueContractEmailNotification: mocks.enqueueManualEmail }));
vi.mock('@alusa/database', () => ({ decryptSecret: mocks.decryptSecret }));
vi.mock('@alusa/domain', () => ({ isMaiorDeIdade: (birth: Date) => new Date().getFullYear() - birth.getFullYear() >= 18 }));

import { drainContractEmailNotifications, queueManualContractEmail } from './contract-email-notification.service';

const row = {
  id: 'email-row-1', contaId: 'conta-1', contratoId: 'contrato-1', matriculaId: 'matricula-1',
  status: 'PROCESSING', attempts: 1, maxAttempts: 8, lockedBy: 'test-worker', recipientEmail: 'aluno@example.com', recipientName: 'Aluno',
  tokenCriptografado: 'public-token', tokenPublicoHash: 'token-hash', deliveryKey: 'contract:contrato-1:email:issued',
  createdAt: new Date(),
};

function currentContract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contrato-1', tokenExpiraEm: new Date(Date.now() + 60_000),
    conta: { nome: 'Escola', contractNotificationsEnabled: true, contractEmailNotificationsEnabled: true },
    matricula: { aluno: { contaId: 'conta-1', nome: 'Aluno', email: 'aluno@example.com', dataNasc: new Date('1990-01-01'), responsaveis: [] }, responsavelFinanceiro: null },
    ...overrides,
  };
}

describe('contract email notification worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decryptSecret.mockImplementation((value: string) => value);
    process.env.APP_URL = 'https://alusa.example';
    mocks.emailFindMany.mockResolvedValue([{ id: row.id }]);
    mocks.emailUpdateMany.mockResolvedValue({ count: 1 });
    mocks.emailFindFirst.mockResolvedValue(row);
    mocks.contractFindFirst.mockResolvedValue(currentContract());
    mocks.emailUpsert.mockResolvedValue({ id: 'email-queued-1', deliveryKey: 'contract:contrato-1:email:manual:op-1' });
    mocks.enqueueManualEmail.mockImplementation(async () => mocks.emailUpsert());
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
    mocks.manualContractFindFirst.mockResolvedValue({
      id: 'contrato-1', matriculaId: 'matricula-1', status: 'PENDENTE',
      tokenPublicoCriptografado: 'public-token', tokenPublicoHash: 'token-hash', tokenExpiraEm: new Date(Date.now() + 60_000),
      conta: { contractNotificationsEnabled: true, contractEmailNotificationsEnabled: true },
      matricula: { aluno: { contaId: 'conta-1', nome: 'Aluno', email: 'aluno@example.com', dataNasc: new Date('1990-01-01'), responsaveis: [] }, responsavelFinanceiro: null },
    });
  });

  it('requires audit persistence before confirming a manual email as queued', async () => {
    mocks.auditCreate.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(queueManualContractEmail({ contaId: 'conta-1', contratoId: 'contrato-1', actorId: 'user-1', operationId: 'op-1' }))
      .rejects.toThrow('audit unavailable');

    expect(mocks.enqueueManualEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      contaId: 'conta-1', contratoId: 'contrato-1', deliveryKey: 'contract:contrato-1:email:manual:op-1',
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CONTRACT_EMAIL_RESEND_QUEUED', actorId: 'user-1' }),
    }));
  });

  it('returns QUEUED only after the audit write succeeds', async () => {
    const result = await queueManualContractEmail({ contaId: 'conta-1', contratoId: 'contrato-1', actorId: 'user-1', operationId: 'op-1' });

    expect(result).toEqual({ status: 'QUEUED', notificationId: 'email-queued-1' });
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
  });

  it('does not mark a logged fallback as provider-accepted', async () => {
    mocks.sendTransactionalEmail.mockResolvedValue({ delivery: 'logged', emailId: null });

    const result = await drainContractEmailNotifications({ contaId: 'conta-1', limit: 1, workerId: 'test-worker' });

    expect(result).toMatchObject({ claimed: 1, accepted: 0, retried: 1 });
    expect(mocks.emailUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: row.id, contaId: 'conta-1', status: 'PROCESSING', lockedBy: 'test-worker' }),
      data: expect.objectContaining({ status: 'FAILED', lastErrorCode: 'EMAIL_PROVIDER_ERROR' }),
    }));
  });

  it('skips a queued send when current tenant settings disable the channel', async () => {
    mocks.contractFindFirst.mockResolvedValue(currentContract({ conta: { nome: 'Escola', contractNotificationsEnabled: false, contractEmailNotificationsEnabled: true } }));

    const result = await drainContractEmailNotifications({ contaId: 'conta-1', limit: 1, workerId: 'test-worker' });

    expect(result).toMatchObject({ claimed: 1, skipped: 1, accepted: 0 });
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(mocks.emailUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED', lastErrorCode: 'CHANNEL_DISABLED' }) }));
  });

  it('does not use an out-of-tenant financial responsible as the email recipient', async () => {
    mocks.contractFindFirst.mockResolvedValue(currentContract({
      matricula: {
        aluno: { contaId: 'conta-1', nome: 'Aluno menor', email: null, dataNasc: new Date('2015-01-01'), responsaveis: [] },
        responsavelFinanceiro: { contaId: 'outra-conta', nome: 'Responsável externo', email: 'externo@example.com' },
      },
    }));

    const result = await drainContractEmailNotifications({ contaId: 'conta-1', limit: 1, workerId: 'test-worker' });

    expect(result).toMatchObject({ claimed: 1, skipped: 1, accepted: 0 });
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(mocks.emailUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED', lastErrorCode: 'RECIPIENT_CHANGED' }) }));
  });

  it('records decrypt preparation failures as retryable or dead-lettered instead of leaving PROCESSING', async () => {
    mocks.decryptSecret.mockImplementation(() => { throw new Error('DECRYPTION_FAILED'); });
    const result = await drainContractEmailNotifications({ contaId: 'conta-1', limit: 1, workerId: 'test-worker' });
    expect(result).toMatchObject({ claimed: 1, retried: 1, deadLettered: 0 });
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(mocks.emailUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));

    vi.clearAllMocks();
    mocks.decryptSecret.mockImplementation(() => { throw new Error('DECRYPTION_FAILED'); });
    mocks.emailFindMany.mockResolvedValue([{ id: row.id }]);
    mocks.emailUpdateMany.mockResolvedValue({ count: 1 });
    mocks.emailFindFirst.mockResolvedValue({ ...row, attempts: 8, lockedBy: 'test-worker' });
    mocks.contractFindFirst.mockResolvedValue(currentContract());
    const exhausted = await drainContractEmailNotifications({ contaId: 'conta-1', limit: 1, workerId: 'test-worker' });
    expect(exhausted).toMatchObject({ claimed: 1, retried: 0, deadLettered: 1 });
    expect(mocks.emailUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DLQ' }) }));
  });
});
