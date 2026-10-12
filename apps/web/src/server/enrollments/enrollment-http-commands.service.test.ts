import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  operationFindFirst: vi.fn(),
  matriculaFindFirst: vi.fn(),
  outboxFindFirst: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    matriculaOperacao: { findFirst: mocks.operationFindFirst },
    matricula: { findFirst: mocks.matriculaFindFirst },
    matriculaBillingOutbox: { findFirst: mocks.outboxFindFirst },
  },
}));
vi.mock('./enrollment-pause.service', () => ({ pausarMatricula: vi.fn(), reativarMatricula: vi.fn() }));
vi.mock('./enrollment-sync.service', () => ({ syncMatriculaStatus: vi.fn() }));

import {
  resolveDeferredCancellationFromHttp,
  resolvePendingCancellationFromHttp,
} from './enrollment-http-commands.service';

describe('resolveDeferredCancellationFromHttp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna operationId e correlationId do outbox com escopo tenant', async () => {
    mocks.outboxFindFirst.mockResolvedValue({ id: 'outbox-1', correlationId: 'correlation-1' });

    await expect(resolveDeferredCancellationFromHttp({ contaId: 'conta-a', matriculaId: 'matricula-1' }))
      .resolves.toEqual({ operationId: 'outbox-1', correlationId: 'correlation-1' });
    expect(mocks.outboxFindFirst).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-a',
        matriculaId: 'matricula-1',
        terminalIntent: 'CANCELADA',
        status: 'PROCESSING',
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, correlationId: true },
    });
  });
});

describe('resolvePendingCancellationFromHttp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna operação retryable e estado atual usando contaId em ambas as consultas', async () => {
    mocks.operationFindFirst.mockResolvedValue({
      id: 'operation-1',
      correlationId: 'correlation-1',
      metadata: { retryable: true },
    });
    mocks.matriculaFindFirst.mockResolvedValue({ status: 'ATIVA' });

    await expect(resolvePendingCancellationFromHttp({ contaId: 'conta-a', matriculaId: 'matricula-1' }))
      .resolves.toEqual({ operationId: 'operation-1', correlationId: 'correlation-1', status: 'ATIVA' });
    expect(mocks.operationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-a', matriculaId: 'matricula-1', tipo: 'CANCELAMENTO', status: 'DIVERGENTE' },
    }));
    expect(mocks.matriculaFindFirst).toHaveBeenCalledWith({
      where: { id: 'matricula-1', contaId: 'conta-a' },
      select: { status: true },
    });
  });

  it('não converte operação não retryable em cancelamento pendente', async () => {
    mocks.operationFindFirst.mockResolvedValue({
      id: 'operation-1',
      correlationId: 'correlation-1',
      metadata: { retryable: false },
    });

    await expect(resolvePendingCancellationFromHttp({ contaId: 'conta-a', matriculaId: 'matricula-1' }))
      .resolves.toBeNull();
    expect(mocks.matriculaFindFirst).not.toHaveBeenCalled();
  });
});
